---
description: Work out this period's progress claim from the tonnes through QA and delivered, less retention and previous claims, and save it as a draft.
---

1. Run `npm run steel -- claim <project> --period-end=<date>` and show the working.
2. If the operator agrees, run it again with `--save`.
3. Render it: `npm run docs -- claim <claim number>`. It states that it is a payment claim under the Construction Contracts Act 2002, the work it covers and how the amount was calculated.
4. Never send it. The operator sends it and then records `npm run steel -- claim-status <claim> --submitted=<date>`.
