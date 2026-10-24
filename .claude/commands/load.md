---
description: Build a truck load: create it, add finished marks, then dispatch it and render the docket.
---

1. `npm run steel -- load-new <project> --planned=<date> --carrier="<name>"` gives the load number.
2. `npm run steel -- load-add <load> <mark> [--qty=N]` for each mark. It only loads finished pieces unless the operator says otherwise (`--force`).
3. When the truck leaves: `npm run steel -- dispatch <load>`.
4. Docket: `npm run docs -- docket <load>` renders it in the company's brand under `docs-out/docket/`.
