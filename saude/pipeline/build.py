"""Oferta de saúde por município, a partir do CNES (DATASUS) e da população do IBGE.

Uso: uv run build.py
Entrada: data/raw/cnes/{LT,EQ,PF}/*.dbc (baixar_cnes.py), data/raw/ibge/populacao.json (baixar_ibge.py),
         malhas e lista de municípios do IBGE em ../energia/data/geo
Saída: web/public/data/*.json e web/public/geo/*.topo.json

Cada competência é lida uma vez e resumida em data/tmp/cache (apague a pasta para reprocessar).
"""

import json
import mmap
import re
import shutil
import struct
import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import datasus_dbc

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CNES = RAW / "cnes"
CACHE = ROOT / "data" / "tmp" / "cache"
GEO = ROOT.parent / "energia" / "data" / "geo"
OUT = ROOT / "web" / "public" / "data"

# Leitos complementares (TP_LEITO 3) não entram no total de leitos de internação, como no TabNet do DATASUS.
LEITO_COMPLEMENTAR = "3"
# UTI: adulto, pediátrica, neonatal (antigos 61 a 63 e tipos I a III), queimados, coronariana e as UTI de SRAG/covid (51, 52)
UTI = {51, 52, 61, 62, 63, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 85, 86}
# Equipamentos de diagnóstico por imagem (TIPEQUIP 1), pelos códigos do CNES
TOMOGRAFO = {11, 26, 27, 28, 29, 30}  # sem o 31 (simulador de radioterapia)
RESSONANCIA = {12, 32, 33, 34, 35}
MAMOGRAFO = {2, 3, 17, 19}
# Médico: CBO 2002 da família 225 (médicos) e os códigos antigos 2231 que ainda aparecem no começo da série
CBO_MEDICO = (b"225", b"2231")
BRASILIA = 5300108


# ---------------------------------------------------------------- leitura de DBC/DBF

def ler_dbc(caminho: Path, campos: list[str]):
    """Gera tuplas de bytes com os campos pedidos de cada registro não apagado. Lê o DBF por mmap, sem converter tudo."""
    with tempfile.NamedTemporaryFile(suffix=".dbf", dir=CACHE.parent) as tmp:
        datasus_dbc.decompress(str(caminho), tmp.name)
        with open(tmp.name, "rb") as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            n, hlen, rlen = struct.unpack("<IHH", mm[4:12])
            pos, off, desc = 32, 1, {}
            while mm[pos] != 0x0D:
                nome = mm[pos:pos + 11].split(b"\0")[0].decode("ascii")
                tam = mm[pos + 16]
                desc[nome] = (off, off + tam)
                off += tam
                pos += 32
            fat = [desc[c] for c in campos]
            for k in range(n):
                ini = hlen + k * rlen
                if mm[ini] == 0x2A:  # '*' = registro apagado
                    continue
                yield tuple(mm[ini + a:ini + b].strip() for a, b in fat)


def inteiro(b: bytes) -> int:
    try:
        return int(b or 0)
    except ValueError:
        return 0


def arquivos(tipo: str, comp: str):
    return sorted((CNES / tipo).glob(f"{tipo}??{comp}.dbc"))


def competencias():
    """AAMM das competências com os 27 estados baixados nos três tipos."""
    por = defaultdict(set)
    for tipo in ("LT", "EQ", "PF"):
        for f in (CNES / tipo).glob("*.dbc"):
            m = re.match(rf"{tipo}([A-Z]{{2}})(\d{{4}})\.dbc$", f.name)
            if m:
                por[m.group(2)].add((tipo, m.group(1)))
    return sorted((c for c, s in por.items() if len(s) == 81), key=lambda c: (int(c[:2]), int(c[2:])))


# ---------------------------------------------------------------- resumo por competência

def resumir_lt(comp):
    out = defaultdict(lambda: [0, 0, 0, 0, set()])  # leitos, leitos SUS, UTI, UTI SUS, estabelecimentos com leito
    for f in arquivos("LT", comp):
        for cnes, mun, tp, cod, qt, sus in ler_dbc(f, ["CNES", "CODUFMUN", "TP_LEITO", "CODLEITO", "QT_EXIST", "QT_SUS"]):
            d = out[mun.decode()]
            qt, sus, cod = inteiro(qt), inteiro(sus), inteiro(cod)
            if tp.decode() != LEITO_COMPLEMENTAR:
                d[0] += qt
                d[1] += sus
                if qt > 0:
                    d[4].add(cnes)
            if cod in UTI:
                d[2] += qt
                d[3] += sus
    return {m: d[:4] + [len(d[4])] for m, d in out.items()}


def resumir_eq(comp):
    out = defaultdict(lambda: [0, 0, 0])  # tomógrafos, ressonâncias, mamógrafos (em uso)
    for f in arquivos("EQ", comp):
        for mun, tipo, cod, uso in ler_dbc(f, ["CODUFMUN", "TIPEQUIP", "CODEQUIP", "QT_USO"]):
            if inteiro(tipo) != 1:
                continue
            cod, uso = inteiro(cod), inteiro(uso)
            d = out[mun.decode()]
            if cod in TOMOGRAFO:
                d[0] += uso
            elif cod in RESSONANCIA:
                d[1] += uso
            elif cod in MAMOGRAFO:
                d[2] += uso
    return dict(out)


def resumir_pf(comp):
    """Médicos contados como pessoas (CPF distinto) em cada município, em cada UF e no Brasil, e os vínculos."""
    por_mun = defaultdict(set)
    sus_mun = defaultdict(set)
    vinc = defaultdict(int)
    por_uf = defaultdict(set)
    sus_uf = defaultdict(set)
    br, br_sus = set(), set()
    sem_id = 0
    for f in arquivos("PF", comp):
        uf = f.name[2:4]
        for mun, cbo, cpf, cns, sus in ler_dbc(f, ["CODUFMUN", "CBO", "CPF_PROF", "CNS_PROF", "PROF_SUS"]):
            if not cbo.startswith(CBO_MEDICO):
                continue
            m = mun.decode()
            vinc[m] += 1
            # o CPF vem embaralhado no arquivo público, mas de forma fixa: serve para contar pessoas distintas
            chave = cpf if cpf.strip(b"0") else (b"cns" + cns if cns.strip(b"0") else None)
            if chave is None:
                sem_id += 1
                continue
            por_mun[m].add(chave)
            por_uf[uf].add(chave)
            br.add(chave)
            if sus == b"1":
                sus_mun[m].add(chave)
                sus_uf[uf].add(chave)
                br_sus.add(chave)
    return {
        "mun": {m: [len(por_mun[m]), len(sus_mun[m]), vinc[m]] for m in vinc},
        "uf": {u: [len(por_uf[u]), len(sus_uf[u])] for u in por_uf},
        "br": [len(br), len(br_sus)],
        "semId": sem_id,
    }


def resumo_cache(tipo, comp, fn):
    alvo = CACHE / f"{tipo}{comp}.json"
    if alvo.exists():
        return json.loads(alvo.read_text())
    r = fn(comp)
    alvo.write_text(json.dumps(r, separators=(",", ":")))
    print("  ", tipo, comp, "processado", flush=True)
    return r


# ---------------------------------------------------------------- municípios e população

def municipios():
    lista = json.loads((GEO / "municipios.json").read_text())
    out = {}
    for m in lista:
        uf = None
        for k in ("microrregiao", "regiao-imediata"):
            try:
                uf = m[k]["mesorregiao" if k == "microrregiao" else "regiao-intermediaria"]["UF"]["sigla"]
                break
            except (KeyError, TypeError):
                continue
        out[m["id"]] = {"nome": m["nome"], "uf": uf}
    return out


def populacao(muns, anos):
    """População de cada ano: Censo 2010, estimativas anuais, Censo 2022; 2023 (sem estimativa oficial) = média de 2022 e 2024."""
    bruto = json.loads((RAW / "ibge" / "populacao.json").read_text())
    pop = {}
    for a in anos:
        if str(a) in bruto:
            d = {int(k): v for k, v in bruto[str(a)].items()}
        elif a == 2023:
            p22, p24 = bruto["2022"], bruto["2024"]
            d = {int(k): round((p22[k] + p24[k]) / 2) for k in p22 if k in p24}
        else:
            raise SystemExit(f"sem população para {a}")
        for c in muns:
            if c not in d:  # município criado depois: usa o ano mais próximo que tiver
                for b in sorted(bruto, key=lambda x: abs(int(x) - a)):
                    if str(c) in bruto[b]:
                        d[c] = bruto[b][str(c)]
                        break
        pop[a] = d
    return pop


# ---------------------------------------------------------------- saída

CAMADAS = {  # nome: (campo do total, por quantos habitantes, multiplicador para guardar inteiro)
    "leitos": ("leitos", 1_000, 100),
    "leitosSus": ("leitosSus", 1_000, 100),
    "uti": ("uti", 100_000, 10),
    "medicos": ("medicos", 1_000, 100),
    "tomografos": ("tomografos", 100_000, 10),
}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    muns = municipios()
    por6 = {c // 10: c for c in muns}
    comps = competencias()
    if not comps:
        raise SystemExit("nenhuma competência completa em data/raw/cnes (rode baixar_cnes.py)")
    anos = [2000 + int(c[:2]) for c in comps]
    pop = populacao(muns, anos)
    cods = sorted(muns)
    im = {c: i for i, c in enumerate(cods)}

    # tot[i][k] = valores do município i na competência k
    CAMPOS = ["pop", "leitos", "leitosSus", "uti", "utiSus", "hospitais", "medicos", "medicosSus", "vinculos", "tomografos", "ressonancias", "mamografos"]
    tot = [[None] * len(comps) for _ in cods]
    br = {}
    ufs_res = defaultdict(dict)
    fora = defaultdict(int)
    for k, comp in enumerate(comps):
        print("competência", comp, flush=True)
        lt = resumo_cache("LT", comp, resumir_lt)
        eq = resumo_cache("EQ", comp, resumir_eq)
        pf = resumo_cache("PF", comp, resumir_pf)
        a = anos[k]
        for i, c in enumerate(cods):
            p = pop[a].get(c)
            tot[i][k] = dict.fromkeys(CAMPOS, 0) | {"pop": p}
        for fonte, nomes in ((lt, ["leitos", "leitosSus", "uti", "utiSus", "hospitais"]), (eq, ["tomografos", "ressonancias", "mamografos"]), (pf["mun"], ["medicos", "medicosSus", "vinculos"])):
            for m6, vals in fonte.items():
                # até 2016 o CNES separa o DF por região administrativa (5300xx): tudo vai para Brasília
                c = BRASILIA if m6.startswith("53") else por6.get(int(m6) if m6.isdigit() else -1)
                if c is None:
                    fora[comp] += sum(vals[:1])
                    continue
                d = tot[im[c]][k]
                for n, v in zip(nomes, vals):
                    d[n] += v
        # médicos do DF: pessoas distintas no DF inteiro (somar as regiões administrativas contaria a mesma pessoa várias vezes)
        if "DF" in pf["uf"]:
            d = tot[im[BRASILIA]][k]
            d["medicos"], d["medicosSus"] = pf["uf"]["DF"]
        # agregados: soma dos municípios; médicos por CPF distinto dentro da UF e do Brasil
        acc = defaultdict(lambda: defaultdict(int))
        for i, c in enumerate(cods):
            d = tot[i][k]
            if not d["pop"]:
                continue
            for alvo in (acc["BR"], acc[muns[c]["uf"]]):
                for n in CAMPOS:
                    if n not in ("medicos", "medicosSus"):
                        alvo[n] += d[n]
                alvo["municipios"] += 1
                alvo["semLeito"] += d["leitos"] == 0
                alvo["semUti"] += d["uti"] == 0
                alvo["semMedico"] += d["medicos"] == 0
                alvo["semTomografo"] += d["tomografos"] == 0
        acc["BR"]["medicos"], acc["BR"]["medicosSus"] = pf["br"]
        for u, (n1, n2) in pf["uf"].items():
            acc[u]["medicos"], acc[u]["medicosSus"] = n1, n2
        for u, x in acc.items():
            r = dict(x)
            for cam, (campo, por, _) in CAMADAS.items():
                r[cam + "Taxa"] = round(x[campo] / x["pop"] * por, 3) if x["pop"] else None
            if u == "BR":
                br[str(a)] = r
            elif u:
                ufs_res[u][str(a)] = r
        print("   Brasil", {n: br[str(a)][n] for n in ("pop", "leitos", "leitosSus", "uti", "medicos", "tomografos")}, "fora da lista:", fora[comp], flush=True)

    # mapa.json: taxas inteiras (ver CAMADAS) por município e competência; null = sem população
    def taxa(d, campo, por, mult):
        return round(d[campo] / d["pop"] * por * mult) if d["pop"] else None

    camadas = {cam: [[taxa(tot[i][k], campo, por, mult) for k in range(len(comps))] for i in range(len(cods))] for cam, (campo, por, mult) in CAMADAS.items()}
    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
    dump(OUT / "mapa.json", {
        "anos": anos, "comps": [f"20{c[:2]}-{c[2:]}" for c in comps], "cods": cods,
        "nomes": [muns[c]["nome"] for c in cods], "ufs": [muns[c]["uf"] for c in cods],
        "pop": [[tot[i][k]["pop"] for k in range(len(comps))] for i in range(len(cods))],
        "escala": {cam: mult for cam, (_, _, mult) in CAMADAS.items()},
        **camadas,
    })
    dump(OUT / "brasil.json", {"anos": br, "ufs": dict(ufs_res)})
    mun_dir = OUT / "mun"
    shutil.rmtree(mun_dir, ignore_errors=True)
    mun_dir.mkdir()
    for i, c in enumerate(cods):
        dump(mun_dir / f"{c}.json", {"cod": c, "nome": muns[c]["nome"], "uf": muns[c]["uf"], "anos": {str(anos[k]): tot[i][k] for k in range(len(comps))}})
    dump(OUT / "meta.json", {
        "anos": anos, "comps": [f"20{c[:2]}-{c[2:]}" for c in comps], "gerado": date.today().isoformat(),
        "fonte": "CNES (DATASUS, Ministério da Saúde) e IBGE",
        "populacao": {"2010": "Censo 2010", "2022": "Censo 2022", "2023": "média do Censo 2022 e da estimativa de 2024", "outros": "estimativa anual do IBGE"},
    })
    geo = ROOT / "web" / "public" / "geo"
    geo.mkdir(parents=True, exist_ok=True)
    shutil.copy(GEO / "br_municipios.topo.json", geo / "municipios.topo.json")
    shutil.copy(GEO / "br_ufs.topo.json", geo / "ufs.topo.json")
    for a in anos:
        r = br[str(a)]
        print(a, {cam: r[cam + "Taxa"] for cam in CAMADAS}, "sem leito:", r["semLeito"], "sem médico:", r["semMedico"])


if __name__ == "__main__":
    main()
