---
description: Record work done at a station: cut, fit, weld, qa or coat. Stops cutting to an unreleased drawing and coating without a visual inspection.
---

The operator says "B2 all welded" or "4 of the K1 columns back from the galvaniser".

1. Run `npm run steel -- progress <project> <mark> <station> [--qty=N] [--by=<staff code>] [--on=<date>]`. Without `--qty` the whole remainder at that station is recorded.
2. If it refuses, read the reason out. Two refusals are on purpose: cutting to a drawing that is not for construction, and coating a welded mark with no passed visual inspection. Only add `--force` when the operator confirms the builder instructed it in writing (for the drawing) or the inspection is recorded elsewhere.
3. When a mark reaches welding on a CC3 or CC4 project, remind them to record who welded it: `/weld`.
