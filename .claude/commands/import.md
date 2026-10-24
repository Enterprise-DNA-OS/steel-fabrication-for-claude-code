---
description: Bring an assembly list across from Tekla PowerFab or Tekla Structures into a project.
---

1. Ask for the assembly list saved as CSV and which project it belongs to. Create the project first if it is new (`/customise` can add one, or insert it with the operator's details).
2. Dry run: `npm run steel -- import tekla-powerfab <file.csv> --project=<code> --dry-run`. Show marks, tonnes and any skipped rows.
3. If the columns did not match, read the header row and map them; the importer accepts the usual names (Assembly Mark, Main Profile, Quantity, Weight Each, Sequence, Drawing, Revision).
4. Import for real without `--dry-run`. Re-importing a revised list updates the marks, it does not duplicate them.
5. New drawings come in as for approval. Release them with `/release-drawing`. Full guide: `docs/replace-tekla-powerfab.md`.
