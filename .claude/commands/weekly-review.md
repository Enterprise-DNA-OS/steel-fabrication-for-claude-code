---
description: The Monday review, written from three commands: site dates, the compliance position, the money, and the five things that matter this week.
---

Run these three and write the review from what they return. Nothing they do not support goes in.

```
npm run steel -- sequences
npm run steel -- attention
npm run steel -- claims --open
```

Then, no more than a page:

1. **The week in one line.** From `npm run steel -- stats`: active projects, tonnes still to ship, tonnes finished and waiting for a truck, open NCRs, claims outstanding.
2. **Site dates.** Every sequence LATE or at risk, the marks holding it up, and the call to make.
3. **Traceability and welding.** Any gap here leads the actions, because it is the line an auditor reads.
4. **Drawings.** What is cut against an unreleased or revised drawing, and what has been out for approval longest.
5. **Throughput.** `npm run steel -- tonnes --weeks=6`: tonnes through QA a week against the average.
6. **Money.** Claims past their schedule date, and steel earned but not claimed.
7. **Five things to do this week**, picked from the attention list, with why each made it.
8. **One thing to decide.** The single item that needs a person, not a process.

`npm run view -- week` and `npm run view -- money` render the same numbers as printable pages for the Monday meeting.
