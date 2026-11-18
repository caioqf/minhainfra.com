"""Falta de água por município, a partir do SNIS (até 2022) e do SINISA (2023 em diante).

Uso: uv run build.py
Entrada: data/raw (ver README), malhas e lista de municípios do IBGE em ../energia/data/geo
Saída: web/public/data/*.json e web/public/geo/*.topo.json
"""

import csv
import glob
import json
import shutil
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
GEO = ROOT.parent / "energia" / "data" / "geo"
OUT = ROOT / "web" / "public" / "data"
ANO_INI = 2010  # antes disso menos da metade dos municípios informa paralisações
# Acima disso o dado é tratado como erro de preenchimento (ex.: mais de uma paralisação por semana para cada ligação)
MAX_VEZES = 52
MAX_HORAS = 2190  # 3 meses sem água por ligação no ano
MAX_RODIZIO = 366

CAMPOS = ["econ", "paral", "hparal", "atingidas", "rodizio_econ", "rodizios", "hrodizio", "reclam", "perdas", "cobertura", "tarifa", "pop"]


def num(v):
    """Converte '1.606' / '2,50' / 1606 / '' para float ou None."""
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


def ler_snis(muns):
    por6 = {c // 10: c for c in muns}
    dados = {}
    for f in sorted(glob.glob(str(RAW / "snis_serie_historica" / "snis_serie_historica_*.csv"))):
        ano = int(Path(f).stem.rsplit("_", 1)[1])
        if ano < ANO_INI:
            continue
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
                dados[(cod, ano)] = {
                    "econ": g("AG003"), "paral": g("QD002"), "hparal": g("QD003"), "atingidas": g("QD004"),
                    "rodizio_econ": g("QD015"), "rodizios": g("QD021"), "hrodizio": g("QD022"), "reclam": g("QD023"),
                    "perdas": g("IN049_AE"), "cobertura": g("IN055_AE"), "tarifa": g("IN005_AE"), "pop": g("AG001"),
                    "prest": linha[col["Prestadores"]].strip(),
                }
        print("snis", ano, flush=True)
    return dados


def ler_planilha_sinisa(caminho):
    """Planilha da base municipal do SINISA: acha a linha com os códigos dos campos (GTA3001...) e lê as de baixo."""
    import re
    codigo = re.compile(r"^[A-Z]{2,4}\d{4}[A-Z]?$")
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    linhas = {}
    for ws in wb.worksheets:
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
        base = RAW / f"sinisa_{ano}"
        tec = glob.glob(str(base / "**" / "*Base Municipal*" / "*Gest*T*cnica*.xlsx"), recursive=True)
        ind = glob.glob(str(base / "**" / "*Base Municipal*" / "*Indicadores*.xlsx"), recursive=True)
        adm = glob.glob(str(base / "**" / "*Base Municipal*" / "*Administra*.xlsx"), recursive=True)
        t = ler_planilha_sinisa(tec[0])
        i_ = ler_planilha_sinisa(ind[0]) if ind else {}
        a_ = ler_planilha_sinisa(adm[0]) if adm else {}
        for cod, d in t.items():
            if cod not in muns:
                continue
            x = {**a_.get(cod, {}), **i_.get(cod, {}), **d}
            g = lambda k: num(x.get(k))
            e1, e2 = g("GTA0008"), g("GTA0015")
            dados[(cod, ano)] = {
                "econ": (e1 or 0) + (e2 or 0) if e1 is not None or e2 is not None else None,
                "paral": g("GTA3001"), "hparal": g("GTA3007"), "atingidas": g("GTA3002"),
                "rodizio_econ": g("GTA3005"), "rodizios": g("GTA3003"), "hrodizio": g("GTA3008"), "reclam": None,
                "perdas": g("IAG2013"), "cobertura": g("IAG0001"), "tarifa": None, "pop": g("GTA0019"),
                "prest": str(x.get("CAD0005") or "").strip(),
            }
        print("sinisa", ano, len(t), flush=True)
    return dados


def metricas(d):
    """horas sem água por ligação (estimada), vezes sem água por ligação e exposição a rodízio. None = sem dado."""
    econ, paral, atg = d["econ"], d["paral"], d["atingidas"]
    if not econ or paral is None:
        return None, None, None, False
    if paral == 0:
        vezes, horas = 0.0, (0.0 if d["hparal"] is not None else None)  # sem o campo de duração (2023) não dá para afirmar zero horas
    else:
        vezes = atg / econ if atg is not None else None
        horas = atg * (d["hparal"] / paral) / econ if atg is not None and d["hparal"] is not None else None
    # rodízio pode ser diário (até 365 vezes no ano para a mesma ligação); acima disso é erro e só o rodízio sai
    rod = d["rodizio_econ"] / econ if d["rodizio_econ"] is not None else None
    if rod is not None and rod > MAX_RODIZIO:
        rod = None
    suspeito = (vezes is not None and vezes > MAX_VEZES) or (horas is not None and horas > MAX_HORAS)
    if suspeito:
        return None, None, rod, True
    return horas, vezes, rod, False


def main():
    muns = municipios()
    dados = ler_snis(muns) | ler_sinisa(muns)
    anos = sorted({a for _, a in dados})
    cods = sorted(muns)
    ia = {a: k for k, a in enumerate(anos)}

    horas10 = [[None] * len(anos) for _ in cods]
    vezes100 = [[None] * len(anos) for _ in cods]
    rod100 = [[None] * len(anos) for _ in cods]
    econ = [[None] * len(anos) for _ in cods]
    suspeitos = []
    br = defaultdict(lambda: defaultdict(float))
    uf = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for m, cod in enumerate(cods):
        for a in anos:
            d = dados.get((cod, a))
            if not d:
                continue
            k = ia[a]
            econ[m][k] = round(d["econ"]) if d["econ"] else None
            h, v, r, s = metricas(d)
            if s:
                suspeitos.append([m, k])
            if h is not None: horas10[m][k] = round(h * 10)
            if v is not None: vezes100[m][k] = round(v * 100)
            if r is not None: rod100[m][k] = round(r * 100)
            # agregados ponderados pelas ligações (economias) dos municípios que informaram
            for alvo in (br[a], uf[muns[cod]["uf"]][a]):
                if v is not None:
                    alvo["econ_v"] += d["econ"]; alvo["vezes"] += v * d["econ"]; alvo["n_v"] += 1
                    alvo["paral"] += d["paral"] or 0; alvo["atingidas"] += d["atingidas"] or 0
                if h is not None:
                    alvo["econ_h"] += d["econ"]; alvo["horas"] += h * d["econ"]; alvo["n_h"] += 1
                if r is not None:
                    alvo["econ_r"] += d["econ"]; alvo["rod"] += r * d["econ"]
    def resumo(x):
        return {
            "horas": round(x["horas"] / x["econ_h"], 2) if x["econ_h"] else None,
            "vezes": round(x["vezes"] / x["econ_v"], 3) if x["econ_v"] else None,
            "rodizio": round(x["rod"] / x["econ_r"], 3) if x["econ_r"] else None,
            "municipios": int(x["n_v"]), "municipiosHoras": int(x["n_h"]),
            "econ": round(x["econ_v"]), "paralisacoes": round(x["paral"]), "atingidas": round(x["atingidas"]),
        }

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
    dump(OUT / "mapa.json", {
        "anos": anos, "cods": cods, "nomes": [muns[c]["nome"] for c in cods], "ufs": [muns[c]["uf"] for c in cods],
        "econ": econ, "horas10": horas10, "vezes100": vezes100, "rodizio100": rod100, "suspeitos": suspeitos,
    })
    dump(OUT / "brasil.json", {
        "anos": {str(a): resumo(br[a]) for a in anos},
        "ufs": {u: {str(a): resumo(x[a]) for a in anos} for u, x in uf.items() if u},
    })
    mun_dir = OUT / "mun"
    shutil.rmtree(mun_dir, ignore_errors=True)
    mun_dir.mkdir()
    for cod in cods:
        linhas = {}
        for a in anos:
            d = dados.get((cod, a))
            if d:
                linhas[str(a)] = {k: (round(d[k], 2) if isinstance(d[k], float) else d[k]) for k in CAMPOS + ["prest"]}
        dump(mun_dir / f"{cod}.json", {"cod": cod, "nome": muns[cod]["nome"], "uf": muns[cod]["uf"], "anos": linhas})
    dump(OUT / "meta.json", {
        "anos": anos, "gerado": date.today().isoformat(), "maxVezes": MAX_VEZES, "maxHoras": MAX_HORAS, "maxRodizio": MAX_RODIZIO,
        "quebra": 2023, "semDuracao": [a for a in anos if not any(horas10[m][ia[a]] is not None for m in range(len(cods)))],
        "fonte": "SNIS (série histórica) e SINISA, Ministério das Cidades",
    })
    geo = ROOT / "web" / "public" / "geo"
    geo.mkdir(parents=True, exist_ok=True)
    shutil.copy(GEO / "br_municipios.topo.json", geo / "municipios.topo.json")
    shutil.copy(GEO / "br_ufs.topo.json", geo / "ufs.topo.json")
    for a in anos:
        print(a, resumo(br[a]))
    print("suspeitos", len(suspeitos))


if __name__ == "__main__":
    main()
