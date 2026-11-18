"""Esgoto por município: SNIS (série histórica, até 2022), SINISA (2023 e 2024) e Censo 2022 do IBGE.

Uso: uv run build.py
Entrada: data/raw (ver README); lista de municípios e malhas em ../energia/data/geo
Saída: web/public/data/*.json e web/public/geo/*.topo.json
"""

import csv
import glob
import json
import re
import shutil
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
GEO = ROOT.parent / "energia" / "data" / "geo"
OUT = ROOT / "web" / "public" / "data"
ANO_INI = 2010
CAMADAS = ("semrede", "semtrat", "censo")
# categorias do Censo 2022 (SIDRA 6805, classificação 11558)
CENSO = {
    "46292": "total", "72110": "rede", "72111": "fossa_rede", "72112": "fossa_septica", "72113": "fossa_rudimentar",
    "92858": "vala", "72114": "rio", "72115": "outra", "92861": "sem_banheiro",
}


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    v = str(v).strip()
    if not v or v == "-":
        return None
    try:
        return float(v.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def pct(v):
    """percentual entre 0 e 100; fora disso é erro de preenchimento"""
    return v if v is not None and 0 <= v <= 100 else None


def municipios():
    out = {}
    for m in json.loads((GEO / "municipios.json").read_text()):
        uf = None
        for k, sub in (("microrregiao", "mesorregiao"), ("regiao-imediata", "regiao-intermediaria")):
            try:
                uf = m[k][sub]["UF"]["sigla"]
                break
            except (KeyError, TypeError):
                continue
        out[m["id"]] = {"nome": m["nome"], "uf": uf}
    return out


def ler_snis(muns):
    por6 = {c // 10: c for c in muns}
    dados = {}
    for f in sorted(glob.glob(str(RAW / "snis_serie_historica" / "snis_serie_historica_*.csv"))):
        ano = int(Path(f).stem.rsplit("_", 1)[1])
        with open(f, encoding="utf-8") as fh:
            r = csv.reader(fh, delimiter=";")
            cab = next(r)
            col = {c.split(" - ")[0].strip(): i for i, c in enumerate(cab)}
            for linha in r:
                if not linha or "TOTAL" in ";".join(linha[:3]) or not (linha[0].strip().isdigit() or linha[1].strip().isdigit()):
                    continue
                cod = int(linha[col["Código do IBGE"]]) if linha[col["Código do IBGE"]].strip() else por6.get(int(linha[col["Código do Município"]] or 0))
                if cod not in muns:
                    continue
                g = lambda k: num(linha[col[k]]) if k in col and col[k] < len(linha) else None
                atend = pct(g("IN056_AE"))
                trat = pct(g("IN046_AE"))
                dados[(cod, ano)] = {
                    "atend": atend, "tratado": trat, "trat_coletado": pct(g("IN016_AE")), "coleta": pct(g("IN015_AE")),
                    "pop_atend": g("ES001"), "extrav": g("QD011"), "extrav_km": g("IN082_AE"),
                    "prest": linha[col["Prestadores"]].strip() if "Prestadores" in col else "",
                }
        print("snis", ano, flush=True)
    return dados


def ler_planilha_sinisa(caminho):
    codigo = re.compile(r"^[A-Z]{2,4}\d{4}[A-Z]?$")
    linhas = {}
    for ws in openpyxl.load_workbook(caminho, read_only=True, data_only=True).worksheets:
        cab = None
        for r in ws.iter_rows(values_only=True):
            if cab is None:
                vals = [str(c).strip() if c is not None else "" for c in r]
                if sum(1 for v in vals if codigo.match(v)) >= 3:
                    cab = vals
                continue
            if not r or not isinstance(r[0], (int, float)):
                continue
            d = linhas.setdefault(int(r[0]), {})
            for c, v in zip(cab, r):
                if c and c not in d:
                    d[c] = v
    return linhas


def ler_sinisa(muns):
    dados = {}
    for ano in (2023, 2024):
        arqs = glob.glob(str(RAW / f"sinisa_{ano}" / "**" / "*.xlsx"), recursive=True)
        ind = next((a for a in arqs if "Indicadores" in a), None)
        tec = next((a for a in arqs if "cnica" in a), None)
        i_ = ler_planilha_sinisa(ind) if ind else {}
        t_ = ler_planilha_sinisa(tec) if tec else {}
        for cod in set(i_) | set(t_):
            if cod not in muns:
                continue
            x = {**t_.get(cod, {}), **i_.get(cod, {})}
            g = lambda k: num(x.get(k))
            p1, p2 = g("GTE0001"), g("GTE0002")
            dados[(cod, ano)] = {
                "atend": pct(g("IES0001")), "tratado": pct(g("IES2003")), "trat_coletado": pct(g("IES2004")), "coleta": pct(g("IES2002")),
                "pop_atend": (p1 or 0) + (p2 or 0) if p1 is not None or p2 is not None else None,
                "extrav": g("GTE3002"), "extrav_km": g("IES3001"),
                "prest": str(x.get("CAD0005") or "").strip(),
            }
        print("sinisa", ano, len(i_), len(t_), flush=True)
    return dados


def ler_censo():
    d = json.loads((RAW / "censo2022_6805.json").read_text())
    out = defaultdict(dict)
    for r in d[0]["resultados"]:
        cat = next(iter(r["classificacoes"][0]["categoria"]))
        nome = CENSO.get(cat)
        if not nome:
            continue
        for s in r["series"]:
            v = s["serie"].get("2022")
            out[int(s["localidade"]["id"])][nome] = int(v) if v and v.isdigit() else 0
    return out


def main():
    muns = municipios()
    dados = ler_snis(muns) | ler_sinisa(muns)
    censo = ler_censo()
    anos = sorted({a for _, a in dados if a >= ANO_INI})
    cods = sorted(muns)
    ia = {a: k for k, a in enumerate(anos)}
    dom = {c: censo.get(c, {}).get("total", 0) for c in cods}  # peso: domicílios do Censo 2022

    camadas = {c: [[None] * len(anos) for _ in cods] for c in CAMADAS}
    agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # [chave][ano][campo]
    for m, cod in enumerate(cods):
        ce = censo.get(cod, {})
        sem_rede_censo = None
        if ce.get("total"):
            sem_rede_censo = 100 * (1 - (ce.get("rede", 0) + ce.get("fossa_rede", 0)) / ce["total"])
        for a in anos:
            k = ia[a]
            if sem_rede_censo is not None:
                camadas["censo"][m][k] = round(sem_rede_censo * 10)
            d = dados.get((cod, a))
            if d:
                if d["atend"] is not None:
                    camadas["semrede"][m][k] = round((100 - d["atend"]) * 10)
                if d["tratado"] is not None:
                    camadas["semtrat"][m][k] = round((100 - d["tratado"]) * 10)
            w = dom[cod]
            for chave in ("BR", muns[cod]["uf"]):
                x = agg[chave][a]
                for c in CAMADAS:
                    v = camadas[c][m][k]
                    # como na conta oficial do SNIS, município que não informou rede/tratamento conta como sem atendimento
                    if v is None and c != "censo":
                        v = 1000
                        x[c + "_semdado"] += w
                    if v is not None and w:
                        x[c] += v / 10 * w
                        x[c + "_w"] += w
                        x[c + "_n"] += 1 if camadas[c][m][k] is not None else 0
    def resumo(x):
        return {**{c: (round(x[c] / x[c + "_w"], 2) if x[c + "_w"] else None) for c in CAMADAS},
                **{c + "Municipios": int(x[c + "_n"] - 0) for c in CAMADAS},
                **{c + "SemDado": round(x[c + "_semdado"] / x[c + "_w"], 3) if x[c + "_w"] else None for c in ("semrede", "semtrat")}}

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
    dump(OUT / "mapa.json", {
        "anos": anos, "cods": cods, "nomes": [muns[c]["nome"] for c in cods], "ufs": [muns[c]["uf"] for c in cods],
        "dom": [dom[c] for c in cods], "camadas": camadas,
    })
    dump(OUT / "brasil.json", {
        "anos": {str(a): resumo(agg["BR"][a]) for a in anos},
        "ufs": {u: {str(a): resumo(agg[u][a]) for a in anos} for u in sorted(k for k in agg if k != "BR" and k)},
    })
    mun_dir = OUT / "mun"
    shutil.rmtree(mun_dir, ignore_errors=True)
    mun_dir.mkdir()
    for cod in cods:
        linhas = {str(a): {k: (round(v, 2) if isinstance(v, float) else v) for k, v in dados[(cod, a)].items()} for a in anos if (cod, a) in dados}
        dump(mun_dir / f"{cod}.json", {"cod": cod, "nome": muns[cod]["nome"], "uf": muns[cod]["uf"], "anos": linhas, "censo": censo.get(cod, {})})
    dump(OUT / "meta.json", {
        "anos": anos, "gerado": date.today().isoformat(), "quebra": 2023,
        "fonte": "SNIS (série histórica) e SINISA, Ministério das Cidades; Censo Demográfico 2022, IBGE (tabela 6805)",
    })
    geo = ROOT / "web" / "public" / "geo"
    geo.mkdir(parents=True, exist_ok=True)
    shutil.copy(GEO / "br_municipios.topo.json", geo / "municipios.topo.json")
    shutil.copy(GEO / "br_ufs.topo.json", geo / "ufs.topo.json")
    for a in anos:
        print(a, resumo(agg["BR"][a]))


if __name__ == "__main__":
    main()
