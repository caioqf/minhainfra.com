"""Baixa os parquets anuais de interrupções da ANEEL (um por vez; o portal recusa downloads paralelos).

Uso: uv run download.py [ANO ...]   (sem argumentos baixa todos os anos disponíveis)
"""

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
CKAN = "https://dadosabertos.aneel.gov.br/api/3/action/package_show?id=interrupcoes-de-energia-eletrica-nas-redes-de-distribuicao"


def recursos() -> dict[str, str]:
    with urllib.request.urlopen(CKAN, timeout=60) as r:
        pkg = json.load(r)["result"]
    out = {}
    for res in pkg["resources"]:
        if res["format"].upper() == "PARQUET":
            ano = res["name"].rsplit("-", 1)[-1].split(".")[0]
            out[ano] = res["url"]
    return out


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    disp = recursos()
    anos = sys.argv[1:] or sorted(disp)
    for ano in anos:
        destino = RAW / f"interrupcoes_{ano}.parquet"
        print(f"{ano}: baixando", flush=True)
        subprocess.run(
            ["curl", "-sfL", "--retry", "5", "--retry-delay", "10", "-C", "-", "-o", str(destino), disp[ano]],
            check=True,
        )
        print(f"{ano}: ok {destino.stat().st_size // 1_000_000} MB", flush=True)


if __name__ == "__main__":
    main()
