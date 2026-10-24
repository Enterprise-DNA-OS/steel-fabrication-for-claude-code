<h1 align="center">Steel Fabrication for Claude Code</h1>

<p align="center">
  <strong>The open-source steel fabrication system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Tekla PowerFab data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=tekla-powerfab">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/tekla-powerfab?utm_source=github&utm_medium=readme&utm_campaign=tekla-powerfab">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-tekla-powerfab">Instead of Tekla PowerFab</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Steel Fabrication for Claude Code does the production control, traceability and progress-claim side of the job you pay Tekla PowerFab for, as a Postgres database and a set of agent commands. It does not do estimating, nesting or CNC output: keep your nesting software for that. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Tekla PowerFab dashboard cannot.

Trimble does not publish a price for Tekla PowerFab: it is quoted through resellers, module by module (estimating, project management, purchasing, inventory, production control), and a 10 to 50 person fabricator usually adds implementation, training and an annual subscription per licence on top. Ask your reseller for your all-in yearly figure and compare it with what this costs: nothing, or a setup fee and a retainer if Enterprise DNA runs it for you.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=tekla-powerfab).

It is built for a structural steel fabricator working for builders: projects and their AS/NZS 5131 construction category, the drawings and their revisions, erection sequences and the dates the site needs them, the piece marks from the detailer's model and what each station on the floor has finished, the heat lots and mill certificates behind each mark, who welded it to which procedure and whether they were qualified that day, inspections and NCRs, the trucks, and the progress claim. The words are the words a fabrication shop already uses.

**Nothing sends or talks to another system on its own.** Dockets, claims and chase notes are drafted here and a person sends them. The gates are real, though: a mark does not get cut to a drawing that is not released for construction, a welded mark does not go to coating without a passed visual inspection, and a failed test raises an NCR on the spot.

```
/attention                 everything that wants a decision, worst first
/sequences                 erection sequences against the site dates, and what is holding each up
/floor                     tonnes at each station, and the marks that have stopped moving
/holds                     steel cut against an unreleased or revised drawing
/trace                     one mark's heat lots, mill certificates, welders, inspections and gaps
/welders                   qualifications, six-monthly confirmations, expiries
/claim                     this period's progress claim, worked out from the tonnes
/compliance                nine rules from AS/NZS 5131, ISO 9606-1 and the Construction Contracts Act
/weekly-review             the Monday review, written from three commands
```

Every progress number reads one view, `v_assembly_status`: the floor, the sequences, the loads, the claim and the attention list can never disagree about where a mark is.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/steel-fabrication-for-claude-code.git
cd steel-fabrication-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database and loads Kowhai Steel (a demo Tauranga fabricator with four projects: a ground floor sequence 3 days late with 4.5 t still in the yard, a column cut from a heat lot with no mill certificate, a transfer beam cut to a drawing still out for approval, a beam cut to rev B when the drawing is now rev C, a welder whose ISO 9606-1 confirmation lapsed in August, a failed UT test on a CC3 splice, a truck that never left, and a payment claim with no payment schedule after 20 working days), then prints the sequences, the attention list and the trace of one mark.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/sequences`, `/floor`, `/holds`, `/trace P-214 K2`, `/welders`, `/claim P-214`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), and put your name, logo and colours in [brand.json](brand.json) so the dockets, claims and data reports carry them.

## Your first hour: ten things to ask for

1. "What needs attention today?"
2. "Which sequences will be late, and which marks are holding them up?"
3. "Bring in this Tekla assembly list for the cold store job."
4. "D-105 is approved for construction."
5. "All six B2 beams are welded, Sione did them to WPS-03."
6. "Which marks have we cut with no heat number recorded?"
7. "Show me everything behind mark K2: heats, certificates, welders, tests."
8. "Who needs their welder confirmation signed this month?"
9. "Build tomorrow's truck for Bayfair from what is finished."
10. "Work out this month's progress claim for P-214 and draft it."

## Ten questions answered from your own records

Every one is a real command or query on the demo data today.

1. Which marks were welded by someone whose qualification was not current for that project's construction category on the day? (`compliance`, rule R4)
2. Which marks were cut to a drawing revision that has since changed, and have not shipped? (`holds`)
3. Which erection sequence is going to miss its site date, and at which station is it stuck? (`sequences`)
4. Which CC2 main members, or any CC3 item, were cut with no heat lot recorded? (`compliance`, rule R2)
5. Which heat lots in use still have no mill certificate, and which marks did they go into? (`lots --no-cert`)
6. How many tonnes went through QA each week, and is that enough for the next three sequences? (`tonnes`, `sequences`)
7. What have we earned on each job and not yet claimed? (`attention`, money)
8. Which claims have gone past the payment schedule deadline? (`claims`)
9. Which marks have not moved for a week, and where are they sitting? (`floor`)
10. What would the manufacturer's data report for this project show as missing today? (`npm run docs -- mdr P-214`)

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/stats` | The shop in four lines. |
| `/projects` | Active projects with tonnes in the model, through QA and dispatched. |
| `/project` | One project in full: sequences, stages, drawings, NCRs, claims, notes. |
| `/drawings` | Drawings by status, with days out for approval. |
| `/holds` | Steel cut against an unreleased or revised drawing, and drawings waiting on others. |
| `/release-drawing` | Record a revision or a status change on a drawing. |
| `/marks` | Piece marks with each station's count, by project, sequence or stage. |
| `/mark` | One mark: drawing, stations, who did what, loads. |
| `/floor` | Tonnes at each station and the marks that have stalled. |
| `/progress` | Record work at cut, fit, weld, qa or coat, with the drawing and inspection gates. |
| `/sequences` | Erection sequences against the site dates. |
| `/ready` | Finished steel not on a truck, by site date. |
| `/load` | Build a truck, dispatch it, render the docket. |
| `/lots` | Heat lots, mill certificates and where each lot went. |
| `/receive` | Book in steel with its heat number and certificate. |
| `/allocate` | Record which heat lot a mark was cut from. |
| `/trace` | A mark's full traceability and any gap that stops sign-off. |
| `/welders` | Qualifications, confirmations and expiries. |
| `/weld` | Record who welded a mark and to which WPS. |
| `/confirm-welder` | Record an ISO 9606-1 six-monthly confirmation. |
| `/inspect` | Record an inspection; a fail raises an NCR. |
| `/ncr` | Raise an NCR. |
| `/ncrs` | NCRs, open first. |
| `/tonnes` | Tonnes cut, through QA and sent each week. |
| `/claim` | Work out and draft this period's progress claim. |
| `/claims` | Claims and where each stands; late schedules flagged. |
| `/draft-chase` | Draft a chase for drawings out for approval. |
| `/draft-overdue-claim` | Draft the follow-up on a claim with no schedule in time. |
| `/documents` | Dockets, payment claims, the manufacturer's data report. |
| `/view` | Printable dashboards: the week, traceability, money. |
| `/new-view` | Add a dashboard in plain language. |
| `/compliance` | Nine rules checked against the records, each with its source. |
| `/import` | Bring an assembly list across from Tekla PowerFab. |
| `/export` | Every table to CSV. |
| `/log` | A note on a project. |
| `/customise` | Make it yours: a field, a stage, a rule, in plain language. |

Every command drives one CLI, `npm run steel -- <command>`, which you can also run yourself. `npm run steel -- help` lists it all.

## Instead of Tekla PowerFab

Export the assembly list for a job from Tekla PowerFab (or the assembly report from Tekla Structures) to Excel, save it as CSV, and run:

```bash
npm run steel -- import tekla-powerfab assembly-list.csv --project=P-301 --dry-run
npm run steel -- import tekla-powerfab assembly-list.csv --project=P-301
```

Marks, quantities, weights, profiles, grades, sequences and drawing numbers come across. Re-importing a revised list updates the marks rather than duplicating them. Heat lots, welder records and open jobs' station progress are a short one-off entry. What maps and what does not: [docs/replace-tekla-powerfab.md](docs/replace-tekla-powerfab.md).

## Architecture

```
steel-fabrication-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Steel Fabrication for Claude Code for your business, migrates your Tekla PowerFab data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=tekla-powerfab)
- Read more: [enterprisedna.co/omni/instead-of/tekla-powerfab](https://enterprisedna.co/omni/instead-of/tekla-powerfab?utm_source=github&utm_medium=readme&utm_campaign=tekla-powerfab)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
