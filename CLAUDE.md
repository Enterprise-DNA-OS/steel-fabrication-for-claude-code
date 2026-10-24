# Steel Fabrication for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing / what is wrong today | `/attention` |
| The Monday review | `/weekly-review` |
| Will we make the site dates? Which sequence is late? | `/sequences` |
| Where is the steel / what is stuck on the floor | `/floor` |
| A mark or a project in full | `/mark`, `/project` |
| Something got cut, fitted, welded, QA'd or came back from coating | `/progress` |
| A drawing was approved, revised or put on hold | `/release-drawing` |
| What is cut against an unreleased drawing | `/holds` |
| Steel arrived / a mill certificate arrived | `/receive` |
| Which heat went into a mark | `/allocate` |
| Everything behind a mark, for the engineer or certifier | `/trace` |
| Who welded it / welder tickets | `/weld`, `/welders`, `/confirm-welder` |
| A test passed or failed | `/inspect`, `/ncrs` |
| What can go on a truck / build a load / docket | `/ready`, `/load`, `/documents` |
| Tonnes this week | `/tonnes` |
| This month's claim / who has not paid | `/claim`, `/claims`, `/draft-overdue-claim` |
| Chase drawing approvals | `/draft-chase` |
| Are we compliant | `/compliance` |
| Bring data across from Tekla PowerFab | `/import` |
| Add a field, change a rule, rename a station | `/customise` |
| A new dashboard | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run steel -- help`) and then propose a new command for it.

## Hard rules

- Construction category rules what traceability is owed. CC2: lot traceability for main members. CC3 and CC4: every item, plus who welded it and to which WPS. Read `docs/compliance.md` before answering a traceability question.
- Never record a weld, an inspection or a heat lot the operator did not tell you about. A gap is a gap until someone fills it with the real record.
- `--force` on `progress` or `load-add` only with the operator's say-so, and log why with `steel log`.

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Tekla PowerFab.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/tekla-powerfab
