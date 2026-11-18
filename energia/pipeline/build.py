"""Gera os JSONs estáticos do site a partir dos parquets de interrupções da ANEEL.

Uso: uv run build.py [ANO ...]   (sem argumentos usa todos os parquets baixados)

Métrica principal: horas sem luz por domicílio (estimativa)
    = soma(consumidores afetados x duração em horas) / domicílios do município (Censo 2022)
A ANEEL não publica número de consumidores por município; o domicílio do Censo é a aproximação.

Dois formatos de origem:
- 2026 em diante: cada interrupção traz o código IBGE do município.
- até 2025: só o conjunto de unidades consumidoras (área de atendimento). O consumidor-hora de cada
  conjunto é distribuído entre municípios na proporção de consumidores afetados observada no formato novo.
  Os arquivos antigos trazem linhas repetidas idênticas; usamos DISTINCT.
"""

import json
import shutil
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
GEO = ROOT / "data" / "geo"
OUT = ROOT / "web" / "public" / "data"
DB = ROOT / "data" / "semluz.duckdb"

# Registros que não são "falta de luz" da rede: defeito só dentro da casa do consumidor,
# obra pedida pelo próprio usuário e corte por falta de pagamento (códigos antigos 1, 2 e 4).
EXCLUIR_MOTIVOS = (
    "Falha nas instalações da unidade consumidora sem afetar terceiros",
    "Obras de interesse exclusivo do usuário",
    "Suspensão por inadimplemento do consumidor",
)
EXCLUIR_CODIGOS = (1, 2, 4)
MAX_HORAS = 720  # durações acima de 30 dias são tratadas como erro de registro
CORTE_NOVO = "2026-01-01"  # a partir daqui vale o formato com município
INICIO = "2018-01-01"  # 2017 cobre só ~40% dos conjuntos: a série começa em 2018

UFS = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
    "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
    "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def chave(s: str | None) -> str:
    if not s:
        return ""
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn").upper().strip()


def carregar_referencias(c: duckdb.DuckDBPyConnection) -> None:
    muns = json.loads((GEO / "municipios.json").read_text())
    dom = {d["D1C"]: int(d["V"]) for d in json.loads((GEO / "domicilios_censo2022.json").read_text())[1:] if d["V"].isdigit()}
    rows = [(int(m["id"]), m["nome"], UFS[str(m["id"])[:2]], dom.get(str(m["id"]), 0)) for m in muns]
    c.execute("create or replace table mun (cod int primary key, nome varchar, uf varchar, dom int)")
    c.executemany("insert into mun values (?,?,?,?)", rows)


def staging(c: duckdb.DuckDBPyConnection, anos: list[str]) -> None:
    arquivos = sorted(p for p in RAW.glob("interrupcoes_*.parquet") if (not anos or p.stem.split("_")[1] in anos) and p.stem.split("_")[1] >= INICIO[:4])
    novos, antigos = [], []
    for p in arquivos:
        cols = {r[0] for r in c.sql(f"describe select * from '{p}'").fetchall()}
        (novos if "CodMunicipioIBGE" in cols else antigos).append(str(p))
    print("formato novo:", [Path(a).stem for a in novos], "antigo:", [Path(a).stem for a in antigos], flush=True)
    lista = lambda xs: "[" + ",".join("'" + x + "'" for x in xs) + "]"
    ts = lambda col: (
        f"coalesce(try_cast({col} as timestamp), try_strptime({col}::varchar, '%d/%m/%Y %H:%M:%S'),"
        f" try_strptime({col}::varchar, '%d/%m/%Y %H:%M'))"
    )
    excl = ",".join("'" + m.replace("'", "''") + "'" for m in EXCLUIR_MOTIVOS)
    partes = []
    if novos:
        partes.append(f"""
            select try_cast(CodMunicipioIBGE as int) cod, try_cast(CodConjUnidadeConsumidora as int) conj,
                   trim(DscConjuntoUnidadeConsumidora) cnome, trim(SigAgente) sig, trim(NomAgente) agente,
                   {ts('DatInicioInterrupcao')} ini, {ts('DatFimInterrupcao')} fim,
                   try_cast(QtdConsumidoresAfetados as int) af, try_cast(QtdConsumidoresAtivos as int) ativos,
                   nullif(trim(DscFatoGeradorCausa), '') causa, nullif(trim(DscFatoGeradorDetalhe), '') detalhe,
                   nullif(trim(DscFatoGeradorTipo), '') tipo, nullif(trim(DscLocalizacaoInterrupcao), '') local,
                   coalesce(DscMotivoExpurgo, '') not in ({excl}) valido
            from read_parquet({lista(novos)}, union_by_name = true)""")
    if antigos:
        partes.append(f"""
            select null::int cod, try_cast(IdeConjuntoUnidadeConsumidora as int) conj,
                   trim(DscConjuntoUnidadeConsumidora) cnome, trim(SigAgente) sig, trim(NomAgenteRegulado) agente,
                   {ts('DatInicioInterrupcao')} ini, {ts('DatFimInterrupcao')} fim,
                   try_cast(NumUnidadeConsumidora as int) af, try_cast(NumConsumidorConjunto as int) ativos,
                   nullif(trim(regexp_split_to_array(DscFatoGeradorInterrupcao, '\\s*[;-]\\s*')[3]), '') causa,
                   nullif(trim(regexp_split_to_array(DscFatoGeradorInterrupcao, '\\s*[;-]\\s*')[4]), '') detalhe,
                   nullif(trim(DscTipoInterrupcao), '') tipo, null::varchar local,
                   coalesce(try_cast(IdeMotivoInterrupcao as int), 0) not in {EXCLUIR_CODIGOS} valido
            from (select distinct * from read_parquet({lista(antigos)}, union_by_name = true))""")
    c.execute(f"""
        create or replace table itr as
        select * exclude (valido), (epoch(fim) - epoch(ini)) / 3600.0 h,
               case when cod is null then 'antigo' else 'novo' end fonte
        from ({' union all '.join(partes)})
        where valido and ini is not null and fim > ini and af > 0
          and (epoch(fim) - epoch(ini)) / 3600.0 <= {MAX_HORAS}
          and ini >= timestamp '{INICIO}'
          and ((cod is null and ini < timestamp '{CORTE_NOVO}') or (cod in (select cod from mun) and ini >= timestamp '{CORTE_NOVO}'))
    """)

    # rótulos de causa do formato antigo vêm em maiúsculas sem acento: usa o rótulo do formato novo
    rotulos = {}
    for col in ("causa", "detalhe", "tipo"):
        for (v,) in c.sql(f"select distinct {col} from itr where fonte = 'novo' and {col} is not null").fetchall():
            rotulos[(col, chave(v))] = v
    for col in ("causa", "detalhe"):
        for (v,) in c.sql(f"select distinct {col} from itr where fonte = 'antigo' and {col} is not null").fetchall():
            novo = rotulos.get((col, chave(v)), v.capitalize())
            if novo != v:
                c.execute(f"update itr set {col} = ? where fonte = 'antigo' and {col} = ?", [novo, v])

    # pesos conjunto -> município pela distribuição de consumidores afetados no formato novo
    c.execute("""
        create or replace table peso as
        select conj, cod, sum(af) * 1.0 / sum(sum(af)) over (partition by conj) w
        from itr where fonte = 'novo' and conj is not null group by 1, 2
    """)
    # Conjuntos antigos que mudaram de código: liga ao conjunto novo de mesmo nome
    # (mesma distribuidora; ou, se o nome for único no país, qualquer distribuidora, porque a sigla muda em privatizações).
    # Se ainda faltar e o nome do conjunto for o nome de um município da área da distribuidora, liga ao município.
    c.execute("""
        create or replace table peso_ext as
        with ca as (
            select conj, any_value(sig) sig, any_value(strip_accents(upper(trim(cnome)))) nome
            from itr where fonte = 'antigo' and conj not in (select conj from peso) group by 1),
        cn as (
            select conj, any_value(sig) sig, any_value(strip_accents(upper(trim(cnome)))) nome
            from itr where fonte = 'novo' group by 1),
        unicos as (select nome from cn group by 1 having count(*) = 1),
        liga as (
            select ca.conj antigo, min(cn.conj) novo from ca join cn on cn.nome = ca.nome and cn.sig = ca.sig group by 1
            union all
            select ca.conj, cn.conj from ca join cn on cn.nome = ca.nome
            where ca.nome in (select nome from unicos) and not exists (select 1 from cn x where x.nome = ca.nome and x.sig = ca.sig)),
        ufs_sig as (select distinct i.sig, m.uf from itr i join mun m using (cod) where i.fonte = 'novo'),
        por_mun as (
            select ca.conj, min(m.cod) cod from ca
            join ufs_sig s on s.sig = ca.sig
            join mun m on m.uf = s.uf and strip_accents(upper(m.nome)) = ca.nome
            where ca.conj not in (select antigo from liga) group by 1)
        select conj, cod, w, 'direto' via from peso
        union all select l.antigo, p.cod, p.w, 'nome' from liga l join peso p on p.conj = l.novo
        union all select conj, cod, 1.0, 'municipio' from por_mun
    """)
    # tabela por município: linhas novas com peso 1, antigas distribuídas pelos pesos
    c.execute("""
        create or replace table itr_m as
        select x.*, m.uf from (
            select cod, ini, af * h chi, 1.0 w, causa, detalhe from itr where fonte = 'novo'
            union all
            select p.cod, i.ini, i.af * i.h * p.w, p.w, i.causa, i.detalhe from itr i join peso_ext p using (conj) where i.fonte = 'antigo'
        ) x join mun m using (cod)
    """)
    tot = c.sql("""select fonte, count(*), sum(af*h) from itr group by 1""").fetchall()
    cobertura = c.sql("""select sum(af*h) filter (where conj in (select conj from peso_ext)) / sum(af*h) from itr where fonte='antigo'""").fetchall()[0][0]
    print(c.sql("""select year(ini), round(sum(af*h) filter (where conj in (select conj from peso_ext)) / sum(af*h), 3)
                   from itr where fonte = 'antigo' group by 1 order by 1""").fetchall(), flush=True)
    print("interrupções válidas:", tot, "| cobertura municipal do formato antigo:", cobertura, flush=True)
    c.execute("create or replace table info as select ? cobertura", [cobertura])


def construir(c: duckdb.DuckDBPyConnection) -> None:
    q = lambda s: c.sql(s).fetchall()

    vol = dict(q("select strftime(ini, '%Y-%m'), count(*) from itr group by 1"))
    meses = sorted(vol)
    med = sorted(vol.values())[len(vol) // 2]
    while meses and vol[meses[-1]] < 0.3 * med:  # mês final ainda incompleto
        meses.pop()
    ultimo = meses[-1]
    idx_mes = {m: i for i, m in enumerate(meses)}
    anos = sorted({m[:4] for m in meses})
    # consumidores ativos (soma do maior valor informado por conjunto no ano mais recente) / domicílios do Censo
    consumidores = q(f"""select sum(a) from (select conj, max(ativos) a from itr
                         where year(ini) = {anos[-1]} group by conj)""")[0][0]
    dom_censo = q("select sum(dom) from mun")[0][0]
    k = consumidores / dom_censo
    c.execute(f"update mun set dom = round(dom::double * {k:.6f})")  # a partir daqui 'dom' = consumidores estimados
    dom_total = consumidores
    print(f"consumidores {consumidores:,} | domicílios {dom_censo:,} | fator {k:.3f}", flush=True)
    cobertura = q("select cobertura from info")[0][0]

    # --- mapa: município x mês ---
    muns = q("select cod, nome, uf, dom::bigint from mun order by cod")
    idx_mun = {r[0]: i for i, r in enumerate(muns)}
    grade = [[0] * len(meses) for _ in muns]
    quedas = [[0] * len(meses) for _ in muns]
    for cod, m, chi, n in q("select cod, strftime(ini, '%Y-%m'), sum(chi), sum(w) from itr_m group by 1, 2"):
        if m in idx_mes:
            i = idx_mun[cod]
            grade[i][idx_mes[m]] = round(chi / (muns[i][3] or 1) * 10)
            quedas[i][idx_mes[m]] = round(n)
    dump(OUT / "mapa.json", {
        "meses": meses, "cods": [r[0] for r in muns], "nomes": [r[1] for r in muns],
        "ufs": [r[2] for r in muns], "dom": [r[3] for r in muns], "horas10": grade, "quedas": quedas,
    })

    # --- Brasil e estados ---
    serie = [
        {"m": m, "h": round(chi / dom_total, 3), "n": n, "af": af}
        for m, chi, n, af in q("select strftime(ini, '%Y-%m'), sum(af * h), count(*), sum(af) from itr group by 1 order by 1")
        if m in idx_mes
    ]
    dom_uf = dict(q("select uf, sum(dom) from mun group by 1"))
    uf_mes = defaultdict(lambda: [0.0] * len(meses))
    for uf, m, chi in q("select uf, strftime(ini, '%Y-%m'), sum(chi) from itr_m group by 1, 2"):
        if m in idx_mes:
            uf_mes[uf][idx_mes[m]] = round(chi / dom_uf[uf], 3)

    por_ano = {}
    for ano in anos:
        f = f"year(ini) = {ano} and strftime(ini, '%Y-%m') <= '{ultimo}'"
        chi, n, af = q(f"select sum(af * h), count(*), sum(af) from itr where {f}")[0]
        causas = [
            {"causa": a, "detalhe": b, "chi": round(x), "n": y}
            for a, b, x, y in q(f"""select coalesce(causa, 'Não informada'), coalesce(detalhe, 'Não informado'), sum(af * h), count(*)
                                   from itr where {f} group by 1, 2 order by 3 desc limit 40""")
        ]
        tipos = [{"tipo": a, "chi": round(x)} for a, x in q(f"select coalesce(tipo, 'Não informado'), sum(af * h) from itr where {f} group by 1 order by 2 desc")]
        dist = [
            {"sig": s, "nome": nome, "chi": round(x), "n": y, "consumidores": cons, "dec": round(x / cons, 2) if cons else None}
            for s, nome, x, y, cons in q(f"""
                with c as (select sig, conj, max(ativos) a from itr where {f} group by 1, 2),
                     t as (select sig, sum(a) cons from c group by 1)
                select i.sig, any_value(i.agente), sum(i.af * i.h), count(*), any_value(t.cons)
                from itr i join t using (sig) where {f} group by 1 order by 3 desc""")
        ]
        ufs = [
            {"uf": u, "chi": round(x), "h": round(x / dom_uf[u], 2)}
            for u, x in q(f"select uf, sum(chi) from itr_m where {f} group by 1 order by 1")
        ]
        maiores = [
            {"ini": str(i_), "h": round(h, 1), "af": a, "chi": round(x), "cod": cd, "conj": cn, "causa": ca, "detalhe": de, "sig": s}
            for i_, h, a, x, cd, cn, ca, de, s in q(f"""
                -- um apagão = interrupções do mesmo lugar e distribuidora que começam na mesma hora
                with e as (
                    select min(ini) ini, max(h) h, sum(af) af, sum(af * h) chi, coalesce(cod, -conj) lugar, any_value(cod) cod,
                           any_value(conj) conj, any_value(cnome) cnome, mode(causa) causa, mode(detalhe) detalhe, sig
                    from itr where {f} group by date_trunc('hour', ini), coalesce(cod, -conj), sig)
                select ini, h, af, chi, coalesce(cod, (select cod from peso_ext p where p.conj = e.conj order by w desc limit 1)),
                       cnome, causa, detalhe, sig
                from e order by chi desc limit 20""")
        ]
        por_ano[ano] = {
            "h": round(chi / dom_total, 2), "chi": round(chi), "n": n, "af": af,
            "meses": sum(1 for m in meses if m.startswith(ano)),
            "causas": causas, "tipos": tipos, "distribuidoras": dist, "ufs": ufs, "maiores": maiores,
        }
        print("ano", ano, "ok", flush=True)

    dump(OUT / "brasil.json", {"serie": serie, "ufMes": dict(uf_mes), "anos": por_ano, "domTotal": dom_total})

    # --- ficha por município ---
    fichas = defaultdict(lambda: {"anos": {}, "causas": [], "piores": [], "dist": []})
    for cod, ano, chi, n in q(f"select cod, year(ini), sum(chi), sum(w) from itr_m where strftime(ini, '%Y-%m') <= '{ultimo}' group by 1, 2"):
        fichas[cod]["anos"][str(ano)] = {"chi": round(chi), "n": round(n)}
    for cod, causa, detalhe, chi, n in q(f"""
        select cod, causa, detalhe, chi, n from (
          select cod, coalesce(causa, 'Não informada') causa, coalesce(detalhe, 'Não informado') detalhe, sum(chi) chi, sum(w) n,
                 row_number() over (partition by cod order by sum(chi) desc) r
          from itr_m where ini > timestamp '{ultimo}-01' + interval 1 month - interval 12 month group by 1, 2, 3) where r <= 8"""):
        fichas[cod]["causas"].append({"causa": causa, "detalhe": detalhe, "chi": round(chi), "n": round(n)})
    for cod, ini, h, af, causa, detalhe, local, sig in q("""
        with e as (
            select cod, min(ini) ini, max(h) h, sum(af) af, sum(af * h) chi, mode(causa) causa, mode(detalhe) detalhe, mode(local) local, sig
            from itr where fonte = 'novo' group by cod, date_trunc('hour', ini), sig)
        select cod, ini, h, af, causa, detalhe, local, sig from (
          select *, row_number() over (partition by cod order by chi desc) r from e) where r <= 8 order by cod, chi desc"""):
        fichas[cod]["piores"].append({"ini": str(ini), "h": round(h, 1), "af": af, "causa": causa, "detalhe": detalhe, "local": local, "sig": sig})
    for cod, sig, agente in q("""select cod, sig, any_value(agente) from itr where fonte = 'novo' group by 1, 2 order by 1, sum(af * h) desc"""):
        fichas[cod]["dist"].append({"sig": sig, "nome": agente})
    mun_dir = OUT / "mun"
    shutil.rmtree(mun_dir, ignore_errors=True)
    for cod, nome, uf, dom in muns:
        f = fichas.get(cod, {"anos": {}, "causas": [], "piores": [], "dist": []})
        dump(mun_dir / f"{cod}.json", {"cod": cod, "nome": nome, "uf": uf, "dom": dom, **f})

    dump(OUT / "meta.json", {
        "meses": meses, "anos": anos, "gerado": date.today().isoformat(), "corteMunicipio": CORTE_NOVO,
        "coberturaAntigo": round(cobertura, 4) if cobertura else None,
        "fonte": "ANEEL, Interrupções de Energia Elétrica nas Redes de Distribuição (dadosabertos.aneel.gov.br)",
        "excluidos": list(EXCLUIR_MOTIVOS), "maxHoras": MAX_HORAS,
        "consumidores": consumidores, "fatorConsumidorDomicilio": round(k, 4),
    })


def main() -> None:
    c = duckdb.connect(str(DB))
    c.execute(f"set threads = 3; set memory_limit = '6GB'; set preserve_insertion_order = false; set temp_directory = '{ROOT / 'data' / 'tmp'}'")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    carregar_referencias(c)
    if "--reusar" not in sys.argv:  # --reusar pula a leitura dos parquets e usa as tabelas já montadas
        staging(c, args)
    construir(c)
    geo = ROOT / "web" / "public" / "geo"
    geo.mkdir(parents=True, exist_ok=True)
    shutil.copy(GEO / "br_municipios.topo.json", geo / "municipios.topo.json")
    shutil.copy(GEO / "br_ufs.topo.json", geo / "ufs.topo.json")
    print("pronto", flush=True)


if __name__ == "__main__":
    main()
