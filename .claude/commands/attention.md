---
description: Everything that wants a decision, worst first: traceability gaps, unqualified welds, drawing holds, open NCRs, late sequences, stuck trucks, stalled marks, unclaimed money.
---

1. Run `npm run steel -- attention`.
2. The list is ordered by what costs most if it is wrong. Read it in that order:
   - **Traceability** first. A mark cut with no heat lot, or a lot with no mill certificate, is the question a certifier asks and the one the paperwork cannot answer after the steel is painted.
   - **Welding** next. A weld made by a welder whose qualification had lapsed, or was the wrong standard for the construction category, needs the welding coordinator's decision before the mark ships.
   - **Drawings.** Steel cut to a drawing that is not released, or that changed after cutting, is rework waiting to happen. Stop the mark and get it in writing.
   - **Quality.** Open NCRs and marks through QA without a visual inspection.
   - **Site dates and dispatch.** Late or at-risk sequences and trucks that did not leave. Call the builder before their crane crew calls you.
   - **The floor.** Marks with nothing recorded for a week.
   - **Money.** Claims with no payment schedule in time, and steel earned but not claimed.
3. For each item, give the one action and who owns it (detailer, welding coordinator, QA, workshop manager, office).
4. Anything that needs a letter is drafted to `drafts/`, never sent.

If the operator asks "what should I do today", pick the top three and say why those three.
