# minhainfra / água

Falta de água no abastecimento por município, de 2010 a 2024, com dados do SNIS (série histórica, até 2022) e do SINISA (2023 e 2024), do Ministério das Cidades.

## Rodar

```sh
cd pipeline
uv run baixar_snis.py ../data/raw/snis_serie_historica 2010,2011,...,2022   # série histórica do SNIS (app4.cidades.gov.br)
# SINISA: baixar e extrair SINISA_Resultados_Ref2023.zip e Ref2024.zip (gov.br/cidades) em data/raw/sinisa_2023 e sinisa_2024
uv run build.py                                                            # gera web/public/data/*.json

cd ../web && npm install && npm run dev
```

As malhas e a lista de municípios vêm de `../energia/data/geo`.

## Métricas

- **Horas sem água por ligação (estimativa)** = ligações atingidas × (duração somada ÷ paralisações) ÷ ligações ativas. SNIS: QD004 × QD003 / QD002 / AG003. SINISA: GTA3002 × GTA3007 / GTA3001 / (GTA0008 + GTA0015). Não existe em 2023.
- **Vezes sem água por ligação** = QD004 / AG003 (SINISA: GTA3002 / economias).
- **Rodízio por ligação** = QD015 / AG003 (SINISA: GTA3005 / economias).

Paralisação = interrupção de 6 h ou mais. Dados autodeclarados pelos prestadores; valores impossíveis (mais de 52 vezes ou 2.190 h por ligação no ano) são descartados. Em 2023 a fonte mudou de SNIS para SINISA.
