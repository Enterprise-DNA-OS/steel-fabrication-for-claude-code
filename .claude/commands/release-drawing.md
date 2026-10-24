---
description: Record a drawing revision or a change of status (approved, for construction, on hold, superseded).
---

The operator says something like "D-105 is approved for construction" or "D-103 went to rev D".

1. Run `npm run steel -- drawing <project> <number> --status=for-construction` or `--rev=D` (both together is fine; `--by="Dean Morrow"` records who approved).
2. A new revision clears the approval date. If marks were already cut to the old revision, run `npm run steel -- holds` and show them: each needs checking against the new revision.
