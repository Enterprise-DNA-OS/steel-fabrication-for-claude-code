# Moving off Tekla PowerFab

Plan on one day for the switch on live jobs: the assembly lists import in minutes, and the rest is entering the records that only exist on paper or in someone's head.

## 1. Export the assembly list for each open job

In Tekla PowerFab Production Control, open the job and run the assembly list report, then export it to Excel. Tekla Structures' assembly list report works too. Save the sheet as CSV (UTF-8).

The importer matches columns by name, case-insensitive, and accepts the usual variants:

| This system | Columns it reads |
|---|---|
| mark | Assembly Mark, Main Mark, Mark, Piece Mark, Assembly position |
| qty | Quantity, Qty, No., Number |
| unit_kg | Weight Each (kg), Unit Weight, Weight each, Weight (kg), Weight (or Total Weight divided by quantity) |
| description | Description, Name, Assembly Name |
| main_profile | Main Profile, Profile, Main Member, Shape, Size |
| grade | Grade, Material |
| sequence | Sequence, Seq, Phase, Lot |
| drawing, revision | Drawing, Drawing No, Drawing Number, Sheet; Revision, Rev, Drawing Rev |
| external_ref | Assembly ID, GUID, ID |

If your report uses other headers, rename them in the CSV, or ask Claude Code to map them for you.

## 2. Create the project and import

Create the project with its builder, site, construction category, contract value and contract tonnes (ask Claude Code: "set up a new project P-301 for Harbourline, CC2, $410,000 for 52 tonnes"). Then:

```bash
npm run steel -- import tekla-powerfab assembly-list.csv --project=P-301 --dry-run
npm run steel -- import tekla-powerfab assembly-list.csv --project=P-301
```

The dry run shows marks, tonnes and any rows it skipped. Importing again after a model revision updates quantities, weights and drawings on existing marks rather than duplicating them.

## 3. Bring across what the export does not carry

| Record | How |
|---|---|
| Drawing status | New drawings import as for approval. Release each: `steel drawing P-301 D-501 --status=for-construction --rev=B`. |
| Station progress on open jobs | One line per mark and station: `steel progress P-301 C10 weld --qty=4`. Claude Code can take a photo of the shop board or a spreadsheet and enter it for you. |
| Heat lots and mill certificates | `steel receive` for each lot in the yard, then `steel allocate` for marks already cut. PowerFab's inventory report with heat numbers, exported to CSV, can be entered in one go by asking Claude Code. |
| Welders and WPS | Add each welder's qualification once (`/customise` or ask Claude Code), and your weld procedures. |
| Claims already made | Enter each past claim so the next one deducts them correctly. |

## What does not carry over

- **Estimating and bids.** This system starts at the awarded job. Keep your estimating tool, or ask Enterprise DNA to build estimating into your version.
- **Combining and nesting, CNC files.** Keep your nesting software. Record which heat each mark was cut from here.
- **Purchasing and purchase orders.** Not in the free version; your accounting system holds them. Enterprise DNA can add them.
- **Attached files.** Drawings and certificate PDFs stay in your file store; the records here hold their numbers and file names.
- **Barcode scanning on the floor.** Progress is recorded by asking Claude Code, or in bulk at the end of a shift. A scanning screen is a customisation.

## Running both for a while

Run both for two weeks on one project. Each Friday compare tonnes through QA and dispatched in both, and the claim value. When they agree, stop entering into PowerFab for new jobs and let the old ones finish where they started.
