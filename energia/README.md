# semenergia

Mapa e histórico das interrupções de energia elétrica no Brasil, município por município, com dados abertos da ANEEL (2018 em diante).

## Rodar

```sh
cd pipeline
uv run download.py          # baixa os parquets anuais da ANEEL para data/raw (um por vez)
uv run build.py             # gera web/public/data/*.json (use --reusar para pular a leitura dos parquets)
uv run continuidade.py      # limite.json: DEC x limite e compensações (arquivos em data/raw/continuidade)

cd ../web
npm install
npm run dev                 # http://localhost:5173
npm run build               # site estático em web/dist
```

As malhas e os domicílios do IBGE ficam em `data/geo` (API de malhas v3 e SIDRA tabela 4712).

## Métrica

Horas sem energia por consumidor = soma(consumidores afetados × duração) / consumidores estimados do município
(domicílios do Censo 2022 × fator nacional consumidores/domicílios). Inclui eventos que o DEC oficial expurga
(emergência, dia crítico). Antes de 2026 a ANEEL publicava só o conjunto de unidades consumidoras; o histórico é
distribuído entre municípios pela proporção observada em 2026. Detalhes em "Como medimos", no próprio site.
