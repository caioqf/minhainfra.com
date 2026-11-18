# minhainfra / esgoto

Coleta e tratamento de esgoto por município: SNIS (série histórica, 2010 a 2022), SINISA (2023 e 2024) e Censo Demográfico 2022 do IBGE (tabela 6805).

## Rodar

```sh
cd pipeline
uv run python baixar_snis.py ../data/raw/snis_serie_historica 2010,2011,...,2022    # app4.cidades.gov.br
# SINISA: SINISA_ESGOTO_Planilhas_2023_v2.zip e SINISA_ESGOTO_Planilhas_2024.zip (gov.br/cidades, resultados SINISA),
#         base municipal extraída em data/raw/sinisa_2023 e data/raw/sinisa_2024
# Censo: servicodados.ibge.gov.br/api/v3/agregados/6805/periodos/2022/variaveis/381?localidades=N6[all]&classificacao=11558[all]
#        salvo em data/raw/censo2022_6805.json
uv run build.py
cd ../web && npm install && npm run dev
```

## Métricas

- **Sem rede de esgoto** = 100 − IN056 (SNIS) / 100 − IES0001 (SINISA).
- **Esgoto sem tratamento** = 100 − IN046 (SNIS) / 100 − IES2003 (SINISA), esgoto tratado referido à água consumida.
- **Censo 2022** = domicílios cujo esgoto não vai para rede geral, pluvial ou fossa ligada à rede, sobre o total.

Médias de estados e do Brasil ponderadas pelos domicílios do Censo 2022; município que não informou conta como sem atendimento, como na conta oficial do SNIS (2022: 42,9% sem rede aqui, contra cerca de 44% no SNIS).
