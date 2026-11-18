"""Baixa do FTP público do DATASUS os arquivos do CNES (leitos, equipamentos e profissionais) por UF e competência.

Uso: uv run baixar_cnes.py [destino] [tipos]
  destino: pasta dos brutos (padrão ../data/raw/cnes)
  tipos:   LT,EQ,PF (padrão os três)

Competências: dezembro de cada ano desde 2010 e o mês mais recente publicado.
Baixa um arquivo por vez e pula o que já existe com o mesmo tamanho do FTP.
"""

import re
import subprocess
import sys
from pathlib import Path

FTP = "ftp://ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados"
UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split()
ANO_INI = 2010


def listar(tipo):
    """{nome do arquivo: tamanho} da pasta do tipo no FTP."""
    txt = subprocess.run(["curl", "-s", "--max-time", "120", f"{FTP}/{tipo}/"], capture_output=True, text=True, check=True).stdout
    out = {}
    for linha in txt.splitlines():
        p = linha.split()
        if len(p) >= 4 and p[-1].lower().endswith(".dbc") and p[2].isdigit():
            out[p[-1]] = int(p[2])
    return out


def competencias(arquivos, tipo):
    """AAMM das competências escolhidas: dezembros completos (27 UFs) e o mês mais recente completo."""
    por_comp = {}
    for nome in arquivos:
        m = re.match(rf"{tipo}([A-Z]{{2}})(\d{{4}})\.dbc$", nome, re.I)
        if m:
            por_comp.setdefault(m.group(2), set()).add(m.group(1).upper())
    completas = sorted((c for c, ufs in por_comp.items() if len(ufs) == 27), key=lambda c: (int(c[:2]), int(c[2:])))
    dezembros = [c for c in completas if c.endswith("12") and 2000 + int(c[:2]) >= ANO_INI]
    ultima = completas[-1]
    return dezembros + ([ultima] if ultima not in dezembros else [])


def main():
    destino = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "raw" / "cnes")
    tipos = (sys.argv[2] if len(sys.argv) > 2 else "LT,EQ,PF").split(",")
    for tipo in tipos:
        arquivos = listar(tipo)
        comps = competencias(arquivos, tipo)
        print(tipo, "competências:", ",".join(comps), flush=True)
        pasta = destino / tipo
        pasta.mkdir(parents=True, exist_ok=True)
        for comp in comps:
            for uf in UFS:
                nome = f"{tipo}{uf}{comp}.dbc"
                tam = arquivos.get(nome)
                if tam is None:
                    print("faltando no FTP:", nome, flush=True)
                    continue
                alvo = pasta / nome
                if alvo.exists() and alvo.stat().st_size == tam:
                    continue
                tmp = alvo.with_suffix(".part")
                subprocess.run(["curl", "-s", "--fail", "--retry", "5", "--retry-all-errors", "--retry-delay", "10", "--max-time", "1800", "-o", str(tmp), f"{FTP}/{tipo}/{nome}"], check=True)
                tmp.rename(alvo)
                print(nome, tam, flush=True)


if __name__ == "__main__":
    main()
