---
description: Book in a delivery of steel with its heat number and mill certificate.
---

Ask for the lot reference, profile, heat number, supplier and the mill certificate number or file. Then:

`npm run steel -- receive <lot> --profile=<profile> --heat=<heat> --grade=<grade> --supplier="<name>" --cert=<cert ref> --qty=<lengths>`

Leave out `--cert` if it did not come with the steel; the lot then shows as MISSING until it does. Running it again with `--cert` when the certificate arrives updates the lot.
