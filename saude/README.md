# minhainfra / saúde

Oferta de saúde por município: leitos, leitos SUS, UTI, médicos e tomógrafos por habitante, com dados do CNES (DATASUS, Ministério da Saúde) e população do IBGE. Um retrato por ano (dezembro de 2010 a 2025) mais o mês mais recente.

## Rodar

```sh
cd pipeline
uv run baixar_cnes.py     # ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/Dados/{LT,EQ,PF} (DBC por UF e mês)
uv run baixar_ibge.py     # população: SIDRA 202 (2010), 6579 (estimativas) e 4709 (Censo 2022)
uv run build.py           # gera web/public/data/*.json
cd ../web && npm install && npm run dev
```

## Métricas

- **Leitos** = soma de `QT_EXIST` (sem leitos complementares, `TP_LEITO` 3) ÷ população × 1.000; **Leitos SUS** usa `QT_SUS`.
- **UTI** = `QT_EXIST` com `CODLEITO` de UTI (74 a 83, 85, 86; antigos 61 a 63; covid 51 e 52) ÷ população × 100 mil.
- **Médicos** = pessoas distintas (CPF embaralhado do arquivo público) com CBO 225 ou 2231 ÷ população × 1.000.
- **Tomógrafos** = `QT_USO` de tomógrafos (`TIPEQUIP` 1, `CODEQUIP` 11 e 26 a 30) ÷ população × 100 mil.

Leito registrado não é leito disponível; cidades pequenas dependem do polo regional; em 2022 a população passa a vir do Censo, o que muda um pouco as taxas.
