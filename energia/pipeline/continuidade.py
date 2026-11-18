"""Limites de continuidade da ANEEL (DEC apurado x limite) e compensações pagas.

Roda depois de build.py (usa as tabelas mun e peso_ext do banco e os meses de mapa.json).
Uso: uv run continuidade.py
Saída: web/public/data/limite.json
"""

import json
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "continuidade"
OUT = ROOT / "web" / "public" / "data"
IND = RAW / "indicadores-continuidade-coletivos-2020-2029.parquet"
COMP = RAW / "indicadores-continuidade-coletivos-compensacao-2020-2029.parquet"
LIM = RAW / "indicadores-continuidade-coletivos-limite.csv"
# Até 2021 as compensações vinham em séries anuais/trimestrais com cobertura irregular; a série mensal completa começa em 2022.
INICIO_COMP = 2022


def main() -> None:
    c = duckdb.connect(str(ROOT / "data" / "semluz.duckdb"))
    c.execute(f"set threads = 3; set memory_limit = '4GB'; set temp_directory = '{ROOT / 'data' / 'tmp'}'")
    q = lambda s: c.sql(s).fetchall()
    meses = json.loads((OUT / "mapa.json").read_text())["meses"]
    cods = [r[0] for r in q("select cod from mun order by cod")]
    idx_mun = {cod: i for i, cod in enumerate(cods)}
    idx_mes = {m: i for i, m in enumerate(meses)}

    # Os arquivos da ANEEL trazem cada linha duas vezes: distinct antes de somar.
    c.execute(f"""
        create or replace temp table cm as
        with x as (select distinct IdeConjUndConsumidoras conj, trim(SigAgente) sig, DscConjUndConsumidoras nome, AnoIndice a,
                          NumPeriodoIndice m, SigIndicador s, VlrIndiceEnviado v
                   from '{IND}' where SigIndicador in ('DEC', 'NumCon'))
        select conj, any_value(sig) sig, any_value(nome) nome, a, m,
               max(v) filter (where s = 'DEC') dec, max(v) filter (where s = 'NumCon') n
        from x group by conj, a, m having max(v) filter (where s = 'DEC') is not null
    """)
    c.execute(f"""
        create or replace temp table lim as
        select distinct IdeConjUndConsumidoras conj, AnoLimiteQualidade a, VlrLimite lim
        from read_csv('{LIM}', delim = ';', decimal_separator = ',') where SigIndicador = 'DEC'
    """)
    # compensações mensais pagas a unidades consumidoras (BT, MT e AT; inclui violações em dia crítico)
    c.execute(f"""
        create or replace temp table comp as
        with x as (select distinct IdeConjUndConsumidoras conj, AnoIndice a, NumPeriodoIndice m, SigIndicador s, VlrIndiceEnviado v
                   from '{COMP}'
                   where AnoIndice >= {INICIO_COMP} and regexp_matches(SigIndicador, '^(PG|QT)UC(BTU|BTNU|MTU|MTNU|AT)(DC)?$'))
        select conj, a, m, sum(v) filter (where s like 'PG%') reais, sum(v) filter (where s like 'QT%') qtd from x group by all
    """)
    # mês a mês por conjunto: DEC acumulado em 12 meses e o limite proporcional aos meses de cada ano na janela.
    # Conjuntos que mudaram de código têm menos de 12 meses na janela; com 6 ou mais, compara DEC e limite dos mesmos meses.
    c.execute("""
        create or replace temp table cj as
        select cm.*, l.lim, make_date(a::int, m::int, 1) d,
               sum(dec) over w dec12, sum(l.lim / 12) over w lim12, count(*) over w nm
        from cm left join lim l using (conj, a)
        window w as (partition by conj order by make_date(a::int, m::int, 1) range between interval 11 month preceding and current row)
    """)
    # Nem toda distribuidora publicou o último mês ainda: repete a janela mais recente do conjunto por até 2 meses
    c.execute("""
        create or replace temp table cjf as
        with cal as (select unnest(generate_series((select min(d) from cj), (select max(d) from cj), interval 1 month))::date d),
             grade as (select k.conj, cal.d from (select distinct conj from cj) k cross join cal)
        select g.d, x.conj, x.n, x.dec12, x.lim12, x.nm
        from grade g asof join cj x on x.conj = g.conj and g.d >= x.d
        where date_diff('month', x.d, g.d) <= 2
    """)
    # peso do município dentro do conjunto (fração dos consumidores do conjunto)
    c.execute("create or replace temp table pw as select conj, cod, w from peso_ext")

    # --- razão DEC/limite em 12 meses por município, estado e Brasil ---
    razao = [[None] * len(meses) for _ in cods]
    for cod, d, num, den in q("""
        select pw.cod, strftime(cj.d, '%Y-%m'), sum(pw.w * cj.n * cj.dec12), sum(pw.w * cj.n * cj.lim12)
        from cjf cj join pw using (conj) where cj.nm >= 6 and cj.lim12 > 0 group by 1, 2"""):
        if d in idx_mes and cod in idx_mun and den:
            razao[idx_mun[cod]][idx_mes[d]] = round(100 * num / den)
    uf_razao = defaultdict(lambda: [None] * len(meses))
    for uf, d, num, den in q("""
        select m.uf, strftime(cj.d, '%Y-%m'), sum(pw.w * cj.n * cj.dec12), sum(pw.w * cj.n * cj.lim12)
        from cjf cj join pw using (conj) join mun m using (cod) where cj.nm >= 6 and cj.lim12 > 0 group by 1, 2"""):
        if d in idx_mes and den:
            uf_razao[uf][idx_mes[d]] = round(100 * num / den)
    br_razao = [None] * len(meses)
    br_cons_acima = [None] * len(meses)
    for d, num, den, acima in q("""
        select strftime(d, '%Y-%m'), sum(n * dec12), sum(n * lim12), sum(n) filter (where dec12 > lim12) / sum(n)
        from cjf where nm >= 6 and lim12 > 0 group by 1"""):
        if d in idx_mes:
            br_razao[idx_mes[d]] = round(100 * num / den)
            br_cons_acima[idx_mes[d]] = round(acima or 0, 3)

    # --- por ano (o ano corrente é parcial: DEC acumulado até o último mês publicado, limite anual inteiro) ---
    c.execute("""
        create or replace temp table ca as
        select conj, a, any_value(sig) sig, any_value(nome) nome, sum(dec) dec, avg(n) n, count(*) meses, any_value(l.lim) lim
        from cm left join lim l using (conj, a) group by conj, a
    """)
    c.execute("create or replace temp table compa as select conj, a, sum(reais) reais, sum(qtd) qtd, count(*) meses from comp group by 1, 2")
    br_ano = {}
    for a, meses_a, dec, lim_, acima, nconj, nacima, reais, qtd in q("""
        select a, max(meses), sum(dec * n) / sum(n), sum(lim * n) / sum(n), sum(n) filter (where dec > lim) / sum(n),
               count(*), count(*) filter (where dec > lim),
               (select sum(reais) from compa x where x.a = ca.a), (select sum(qtd) from compa x where x.a = ca.a)
        from ca where lim is not null group by a order by a"""):
        br_ano[str(a)] = {"meses": meses_a, "dec": round(dec, 2), "lim": round(lim_, 2), "consAcima": round(acima or 0, 3),
                          "conjs": nconj, "conjsAcima": nacima,
                          "reais": round(reais) if reais is not None and a >= INICIO_COMP else None,
                          "qtd": round(qtd) if qtd is not None and a >= INICIO_COMP else None}

    dist_ano = defaultdict(list)
    for a, sig, n, dec, lim_, acima, reais, qtd in q("""
        select ca.a, ca.sig, sum(n), sum(dec * n) / sum(n), sum(lim * n) / sum(n), sum(n) filter (where dec > lim) / sum(n),
               sum(x.reais), sum(x.qtd)
        from ca left join compa x using (conj, a) where lim is not null group by 1, 2 order by 1, 2"""):
        dist_ano[str(a)].append({"sig": sig, "n": round(n), "dec": round(dec, 2), "lim": round(lim_, 2), "consAcima": round(acima or 0, 3),
                                 "reais": round(reais) if reais is not None else None, "qtd": round(qtd) if qtd is not None else None})

    uf_ano = defaultdict(dict)
    for uf, a, dec, lim_, reais, qtd in q("""
        select m.uf, ca.a, sum(pw.w * ca.n * ca.dec) / sum(pw.w * ca.n), sum(pw.w * ca.n * ca.lim) / sum(pw.w * ca.n),
               sum(pw.w * x.reais), sum(pw.w * x.qtd)
        from ca join pw using (conj) join mun m using (cod) left join compa x using (conj, a)
        where ca.lim is not null group by 1, 2"""):
        uf_ano[uf][str(a)] = [round(dec, 2), round(lim_, 2), round(reais) if reais is not None else None, round(qtd) if qtd is not None else None]

    # --- por município: [ano, dec, limite, R$, qtd] e as áreas de atendimento que o cobrem ---
    mun_ano = [[] for _ in cods]
    for cod, a, dec, lim_, reais, qtd in q("""
        select pw.cod, ca.a, sum(pw.w * ca.n * ca.dec) / sum(pw.w * ca.n), sum(pw.w * ca.n * ca.lim) / sum(pw.w * ca.n),
               sum(pw.w * x.reais), sum(pw.w * x.qtd)
        from ca join pw using (conj) left join compa x using (conj, a)
        where ca.lim is not null group by 1, 2 order by 1, 2"""):
        if cod in idx_mun:
            mun_ano[idx_mun[cod]].append([a, round(dec, 2), round(lim_, 2), round(reais) if reais is not None else None, round(qtd) if qtd is not None else None])
    ultimo_ano = max(int(a) for a in br_ano)
    mun_conj = [[] for _ in cods]
    for cod, nome, sig, share, dec, lim_, meses_a in q(f"""
        select cod, nome, sig, share, dec, lim, meses from (
          select pw.cod, ca.nome, ca.sig, pw.w * ca.n / sum(pw.w * ca.n) over (partition by pw.cod) share, ca.dec, ca.lim, ca.meses,
                 row_number() over (partition by pw.cod order by pw.w * ca.n desc) r
          from ca join pw using (conj) where ca.a = {ultimo_ano - 1})
        where r <= 4 and share >= 0.02 order by cod, share desc"""):
        if cod in idx_mun:
            mun_conj[idx_mun[cod]].append([nome.strip(), sig, round(share, 3), round(dec, 2), round(lim_, 2) if lim_ is not None else None])

    out = {
        "fonte": "ANEEL, Indicadores Coletivos de Continuidade (DEC e FEC), limites e compensações (dadosabertos.aneel.gov.br)",
        "inicioComp": INICIO_COMP, "anoConj": ultimo_ano - 1,
        "razao": razao, "ufRazao": dict(uf_razao), "brRazao": br_razao, "brConsAcima": br_cons_acima,
        "brAno": br_ano, "distAno": dict(dist_ano), "ufAno": dict(uf_ano), "munAno": mun_ano, "munConj": mun_conj,
    }
    (OUT / "limite.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(br_ano, indent=1))
    print("limite.json", round((OUT / "limite.json").stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
