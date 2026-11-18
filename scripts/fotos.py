"""Foto principal de cada município (Wikidata P18, ligado pelo código IBGE P1585).

Guarda só o caminho do arquivo no Wikimedia Commons (ex.: "a/ab/Nome.jpg"); o site carrega a imagem e o crédito direto da Wikimedia.
Uso: python3 scripts/fotos.py   (grava energia/web/public/data/fotos.json e agua/web/public/data/fotos.json)
"""

import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Q = """SELECT ?ibge ?img WHERE { ?m wdt:P1585 ?ibge ; wdt:P18 ?img . }"""
# brasão, bandeira, mapa de localização e afins não são foto da cidade
RUIM = re.compile(r"bras[aã]o|bandeira|flag|coat|arms|mapa|map|locator|localiza|logo|selo|escudo|\.svg$", re.I)

url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": Q, "format": "json"})
req = urllib.request.Request(url, headers={"User-Agent": "minhainfra-dados/0.1"})
linhas = json.load(urllib.request.urlopen(req, timeout=120))["results"]["bindings"]
fotos: dict[str, str] = {}
for b in sorted(linhas, key=lambda b: b["img"]["value"]):
    arq = urllib.parse.unquote(b["img"]["value"].rsplit("/", 1)[1])
    cod = b["ibge"]["value"]
    if cod.isdigit() and len(cod) == 7 and not RUIM.search(arq) and cod not in fotos:
        # caminho no servidor de imagens (upload.wikimedia.org libera CORS; o link de redirecionamento não)
        nome = arq.replace(" ", "_")
        h = hashlib.md5(nome.encode()).hexdigest()
        fotos[cod] = f"{h[0]}/{h[:2]}/{nome}"
for site in ("energia", "agua"):
    destino = ROOT / site / "web" / "public" / "data" / "fotos.json"
    destino.write_text(json.dumps(fotos, ensure_ascii=False, separators=(",", ":")))
print(len(linhas), "fotos no Wikidata;", len(fotos), "municípios com foto aproveitável")
