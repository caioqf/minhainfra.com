# minhainfra.com

A infraestrutura da sua cidade em dados abertos.

- `energia/`: horas sem energia por município (ANEEL), limites e compensações. Ver `energia/README.md`.
- `agua/`: falta de água no abastecimento (SNIS e SINISA). Ver `agua/README.md`.
- `esgoto/`: rede e tratamento de esgoto (SNIS, SINISA e Censo 2022). Ver `esgoto/README.md`.
- `saude/`: leitos, UTI, médicos e tomógrafos por habitante (DATASUS, CNES). Ver `saude/README.md`.
- `site/`: página inicial.

O deploy é feito pelo GitHub Actions (`.github/workflows/pages.yml`) a cada push na `main`. Os JSON gerados pelos pipelines ficam versionados em `*/web/public/data`; os dados brutos não (baixe e rode os pipelines localmente).
