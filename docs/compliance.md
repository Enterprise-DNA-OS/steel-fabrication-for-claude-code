# Compliance rules

`/compliance` (or `npm run steel -- compliance`) checks the records against these nine rules. Each has its source, what a breach looks like in the data, and the check that finds it. Rules R1 to R6 come from the standards a New Zealand or Australian structural fabricator works to. R7 and R8 are house rules most fabricators run: change them to match your own inspection and test plan and contracts. R9 is New Zealand law; Australian states have their own security of payment Acts with different time limits, so change R9 to your state's Act if you work there.

This is a records check, not engineering or legal advice. Your welding coordinator, your engineer and your adviser make the calls. The standards are paid documents: check the clause numbers against your own copies, and if a rule here is out of date, fix this file and the check together.

## The construction category sets the bar

AS/NZS 5131:2016 *Structural steelwork: Fabrication and erection* has four construction categories, CC1 to CC4, chosen by the designer and written into the specification. Each project in this system carries its category, and the checks read it.

| | CC1 | CC2 | CC3 | CC4 |
|---|---|---|---|---|
| Test certificates | all steel | all steel | all steel | all steel |
| Lot traceability | not specified | main members, connections between them, major plate components | all items | all items |
| Weld categories | GP | GP, SP | GP, SP, FP | GP, SP, FP |
| Welder qualification | AS/NZS 1554 | AS/NZS 1554 | AS/NZS 2980 (ISO 9606-1 accepted) | AS/NZS 2980 (ISO 9606-1 accepted) |
| Welder and WPS traceability | not specified | not specified | required | required |

Sources: AS/NZS 5131:2016 clauses 4.7 and 5.2 and Table 7.4, with Amendment 1 (2020), which reduced CC2 traceability to lot traceability for main members. Summaries: Australian Steel Institute, *AS/NZS 5131 and AS 4100 2020 update* (steel.org.au) and ASI Technical Note TN017 *Traceability*; Weld Australia's AS/NZS 5131 notes (welding.org.au); HERA and SCNZ guidance in New Zealand.

## The rules

### R1. Every steel lot used has its mill test certificate
- **Source:** AS/NZS 5131:2016 clause 5.2: test certificates for all steel material, in every construction category.
- **Breach:** a lot allocated to a mark on an open project with `cert_received = false`.
- **Check:** `allocations` joined to `material_lots` where not `cert_received`. Fix: `npm run steel -- receive <lot> --profile=.. --cert=<ref>` when it arrives.

### R2. Lot traceability for what the category requires
- **Source:** AS/NZS 5131:2016 clauses 4.7.2 and 5.2.3, as amended 2020.
- **Breach:** a mark that has been cut (`cut_qty > 0`) with no allocation, when it is a main member on a CC2 project, or any item on a CC3 or CC4 project.
- **Check:** `v_assembly_status` with no row in `allocations`. Fix: `npm run steel -- allocate <project> <mark> <lot>`.
- **Note:** lot traceability means the lot of identical pieces traces to a set of parent certificates. Piece-mark or piece traceability is only owed at CC3 and CC4 when the specification calls it up; add a rule if yours does.

### R3. Welder and weld procedure traceability at CC3 and CC4
- **Source:** AS/NZS 5131:2016 Table 7.4.
- **Breach:** a welded mark on a CC3 or CC4 project with no `weld_records` row carrying a WPS.
- **Fix:** `npm run steel -- weld <project> <mark> --welder=<code> --wps=<WPS>`.

### R4. Welds made by a welder qualified for the category, current on the day
- **Source:** AS/NZS 5131:2016 Table 7.4 (AS/NZS 1554 at CC1 and CC2; AS/NZS 2980 at CC3 and CC4, with ISO 9606-1 accepted); ISO 9606-1:2012 clauses 9.2 and 9.3.
- **Breach:** a weld record where, on the weld date, the welder held no qualification the category accepts: none on file, not yet qualified, past its expiry, or an ISO 9606-1 qualification more than six months past its last confirmation.
- **Assumption:** a welder qualified to AS/NZS 2980 or ISO 9606-1 is treated as meeting the CC1 and CC2 requirement. Change `ACCEPTED_QUALS` in `scripts/steel.mjs` if your welding coordinator sees it differently.
- **Fix:** the welding coordinator reviews the welds; raise an NCR for any that cannot be accepted. Do not delete the record.

### R5. ISO 9606-1 qualifications confirmed every six months, none expired
- **Source:** ISO 9606-1:2012 clause 9.2 (the welding coordinator or examiner confirms every six months that the welder has worked within the range of qualification) and clause 9.3 (revalidation).
- **Breach:** an active welder whose qualification is past `expires_on`, or whose ISO 9606-1 confirmation is more than six months old.
- **Fix:** `npm run steel -- confirm-welder <code> --on=<date>`, or requalify.

### R6. SP and FP welds only where the category allows them
- **Source:** AS/NZS 5131:2016 Table 7.4 (CC1 permits GP welds only).
- **Breach:** a mark with `weld_category` SP or FP on a CC1 project. Usually a wrong category on the project or the mark; ask the engineer which.

### R7. House rule: no welded mark passes QA without a passed visual weld inspection
- **Source:** your inspection and test plan. AS/NZS 1554.1 requires visual examination of welds; this rule makes sure the record exists before the mark goes to coating, after which the weld cannot be seen.
- **Breach:** a mark with welds and `qa_qty > 0` and no passing `visual` inspection.
- **Gate:** `progress <mark> coat` refuses until the visual pass is recorded.

### R8. House rule: no cutting before release, no shipping steel cut to a superseded revision
- **Source:** your contract with the builder; most say the fabricator works only to drawings issued for construction.
- **Breach:** a mark cut while its drawing is anything other than `for-construction`, or a mark whose drawing revision changed after cutting (`fabricated_rev` differs from the drawing's revision) and has not shipped.
- **Gate:** `progress <mark> cut` refuses on an unreleased drawing unless `--force` is given. Log the builder's written instruction when it is.

### R9. A payment schedule arrives in time for each payment claim
- **Source:** Construction Contracts Act 2002 (New Zealand), sections 20 to 24: a payer who disputes a payment claim must give a payment schedule within the time the contract sets, or 20 working days if it sets none; a payer who gives no schedule in time becomes liable to pay the claimed amount, which the payee can recover as a debt.
- **Breach:** a claim with status `submitted` and more working days since submission than the project's `payment_days` (default 20).
- **Note:** working days are counted Monday to Friday. The Act also excludes public holidays and the summer close-down from late December to mid-January, so this check can flag a claim a few days early. Treat it as the date to look, and confirm with your adviser before acting.
- **Fix:** record the schedule when it comes (`claim-status <claim> --scheduled=<amount>`), or draft the follow-up with `/draft-overdue-claim`.

Every payment claim this system renders (`npm run docs -- claim <number>`) states that it is made under the Construction Contracts Act 2002, identifies the contract, the period and the work, and shows how the amount was calculated, as section 20 requires. Claims to a residential occupier need the prescribed outline form attached as well; add it if you do residential work.
