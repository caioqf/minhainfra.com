"""População residente por município (IBGE, API do SIDRA).

Uso: uv run baixar_ibge.py [destino]   (padrão ../data/raw/ibge/populacao.json)

- Censo 2010: tabela 202 (população residente, total)
- Estimativas anuais: tabela 6579 (2011 a 2021 e 2024 a 2026; não há estimativa para 2022 e 2023)
- Censo 2022: tabela 4709
Grava {"ano": {"código IBGE de 7 dígitos": população}}.
"""

import json
import sys
import urllib.request
from pathlib import Path

SIDRA = "https://apisidra.ibge.gov.br/values"
CONSULTAS = {
    "censo2010": "/t/202/n6/all/v/93/p/2010/c1/0/c2/0/h/n",
    # uma consulta por ano: o SIDRA recusa respostas com mais de 100 mil valores
    **{f"estimativa{a}": f"/t/6579/n6/all/v/9324/p/{a}/h/n" for a in [*range(2011, 2022), *range(2024, 2027)]},
    "censo2022": "/t/4709/n6/all/v/93/p/2022/h/n",
}


def baixar(caminho):
    req = urllib.request.Request(SIDRA + caminho, headers={"User-Agent": "minhainfra-dados/0.1"})
    return json.load(urllib.request.urlopen(req, timeout=300))


def main():
    destino = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "raw" / "ibge" / "populacao.json")
    destino.parent.mkdir(parents=True, exist_ok=True)
    pop: dict[str, dict[str, int]] = {}
    for nome, caminho in CONSULTAS.items():
        linhas = baixar(caminho)
        n = 0
        for r in linhas:
            v = r.get("V", "")
            if not v.isdigit():
                continue
            ano = r["D3C"]
            pop.setdefault(ano, {})[r["D1C"]] = int(v)
            n += 1
        print(nome, n, "linhas", flush=True)
    destino.write_text(json.dumps(dict(sorted(pop.items())), separators=(",", ":")))
    for ano, d in sorted(pop.items()):
        print(ano, len(d), "municípios,", sum(d.values()), "habitantes")


if __name__ == "__main__":
    main()
