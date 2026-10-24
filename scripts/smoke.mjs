#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database: migrate, seed, then every command
// that matters, asserting on the JSON. Passes on Windows and Linux. No network, no Postgres install.
// TEST_DATABASE_URL runs the same test against a real Postgres (CI does this).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'steel-smoke-'));
const exportDir = path.join(dataDir, 'export');
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try { return JSON.parse(res.stdout); } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}
function assert(cond, msg) { if (!cond) { console.error(`\nFAIL assertion: ${msg}`); process.exit(1); } }
const n = (v) => Number(v ?? 0);
const S = (...a) => ['steel.mjs', ...a];

console.log(`smoke: ${env.DATABASE_URL ? 'Postgres' : 'embedded database in ' + dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the overview
  const stats = run('stats', S('stats'));
  assert(stats.active_projects === 3, `three active projects (${stats.active_projects})`);
  assert(stats.open_ncrs === 1, 'one open NCR');

  const projects = run('projects', S('projects'));
  assert(projects.length === 3 && projects.every((p) => p.status === 'active'), 'active projects only by default');
  assert(run('projects --all', S('projects', '--all')).length === 4, 'the finished job shows with --all');

  const card = run('project card by partial name', S('project', 'cold store'));
  assert(card.project.code === 'P-214' && card.project.construction_category === 'CC3', 'fuzzy project lookup');
  run('ambiguous project lists and exits 1', S('project', 'P-2'), { json: false, expectFail: true });

  // ---- drawings
  const holds = run('holds', S('holds'));
  assert(holds.fabrication.length === 3, `three marks on unreleased or revised drawings (${holds.fabrication.length})`);
  assert(holds.fabrication.some((h) => h.mark === 'B2' && /rev C after cutting to rev B/.test(h.problem)), 'revision after cutting caught');
  assert(holds.fabrication.some((h) => h.mark === 'K3' && /on-hold/.test(h.problem)), 'cutting on a held drawing caught');
  assert(holds.waiting.some((w) => w.drawing === 'D-105' && n(w.days_out) === 16), 'D-105 out for approval 16 days');

  // ---- marks and the floor
  const marks = run('marks for one project', S('marks', '--project=P-210'));
  assert(marks.length === 9, `nine marks on P-210 (${marks.length})`);
  const b1 = marks.find((m) => m.mark === 'B1');
  assert(b1.qa === 8 && b1.coat === 5 && b1.stage === 'at coating', 'B1 part-coated');
  const floor = run('floor', S('floor'));
  assert(floor.stalled.some((s) => s.mark === 'G2' && n(s.days) === 12), 'G2 stalled 12 days');

  const seqs = run('sequences', S('sequences'));
  const s1 = seqs.find((s) => s.project === 'P-210' && s.sequence === 'S1');
  assert(s1.risk === 'LATE', 'P-210 S1 is late');
  assert(seqs.find((s) => s.project === 'P-210' && s.sequence === 'S2').risk === 'at risk', 'P-210 S2 at risk');

  const ready1 = run('ready to load', S('ready'));
  assert(ready1.some((r) => r.mark === 'CL1' && r.ready_qty === 40), 'cleats finished and not loaded');

  // ---- moving steel
  run('progress refuses to skip a station', S('progress', 'P-210', 'R1', 'weld'), { json: false, expectFail: true });
  const fit = run('fit-up R1', S('progress', 'P-210', 'R1', 'fit', '--qty=6', '--by=S-DW'));
  assert(fit.stage === 'welding', `R1 moves to welding (${fit.stage})`);
  run('refuses to cut to a drawing out for approval', S('progress', 'P-210', 'B3', 'cut'), { json: false, expectFail: true });
  run('refuses coating without a visual inspection', S('progress', 'P-210', 'B2', 'coat'), { json: false, expectFail: true });

  // ---- material and traceability
  const noCert = run('lots without certificates', S('lots', '--no-cert'));
  assert(noCert.length === 2, 'two lots without mill certificates');
  run('receive a lot', S('receive', 'L-24700', '--profile=460UB74', '--heat=24700', '--cert=MTC-24700.pdf', '--supplier=Steel and Tube'));
  const alloc = run('allocate by heat number', S('allocate', 'P-210', 'B2', '24700'));
  assert(alloc.lot === 'L-24700' && alloc.cert === true, 'B2 traced to the new heat');
  run('certificate arrives for the C2 lot', S('receive', 'L-24203', '--profile=310UC118', '--cert=MTC-24203.pdf'));
  const tr = run('trace C2', S('trace', 'P-210', 'C2'));
  assert(tr.lots[0].cert_received === true, 'C2 lot now has its certificate');
  const k2 = run('trace K2', S('trace', 'P-214', 'K2'));
  assert(k2.gaps.some((g) => /Tom Hale was not qualified for CC3/.test(g)), 'K2 shows the welder gap');
  assert(k2.gaps.some((g) => /NCR-031 is open/.test(g)), 'K2 shows the open NCR');

  // ---- welding
  const welders = run('welders', S('welders'));
  assert(welders.find((w) => w.full_name === 'Sione Lata').qual_status === 'expired', 'Sione expired');
  assert(welders.find((w) => w.full_name === 'Mike Kuru').qual_status === 'confirmation overdue', 'Mike overdue');
  run('confirm Mike', S('confirm-welder', 'W-MK'));
  assert(run('welders after', S('welders')).find((w) => w.full_name === 'Mike Kuru').qual_status === 'current', 'Mike current after confirmation');
  const w = run('record a weld with an expired welder', S('weld', 'P-210', 'R1', '--welder=Sione', '--wps=WPS-03'));
  assert(w.qualified === false, 'warns on the expired welder');
  const w2 = run('record a weld with a qualified welder', S('weld', 'P-214', 'K3', '--welder=W-AR', '--wps=WPS-01'));
  assert(w2.qualified === true, 'Aroha is qualified at CC3');

  // ---- quality
  const fail = run('failed MPI raises an NCR', S('inspect', 'P-210', 'B2', '--kind=mpi', '--result=fail', '--reading=toe crack'));
  assert(/^NCR-\d{3}$/.test(fail.ncr), 'NCR number issued');
  assert(run('open NCRs', S('ncrs', '--open')).length === 2, 'two open NCRs');
  run('close it', S('close-ncr', fail.ncr, '--disposition=repair'));
  run('bad disposition refused', S('close-ncr', 'NCR-031', '--disposition=ignore'), { json: false, expectFail: true });
  run('visual pass on CL1', S('inspect', 'P-210', 'CL1', '--kind=visual', '--result=pass', '--by=Jo Brown'));

  // ---- dispatch
  const load = run('new load', S('load-new', 'P-210', '--carrier=Bay Haulage'));
  assert(/^L-\d{4}$/.test(load.number), 'load number issued');
  run('load cleats', S('load-add', load.number, 'CL1'));
  run('refuses unfinished steel', S('load-add', load.number, 'R1'), { json: false, expectFail: true });
  run('dispatch', S('dispatch', load.number));
  assert(!run('ready after', S('ready')).some((r) => r.mark === 'CL1'), 'cleats no longer waiting');
  run('cannot dispatch twice', S('dispatch', load.number), { json: false, expectFail: true });
  assert(run('open loads', S('loads', '--open')).length === 2, 'two loads still open');

  // ---- money
  const claims = run('claims', S('claims'));
  const late = claims.find((c) => c.number === 'PC-205-04');
  assert(late.schedule_late === true && late.working_days_out > 20, 'PC-205-04 has had no schedule past 20 working days');
  const draft = run('draft claim', S('claim', 'P-214'));
  assert(draft.claimed_cents > 0 && draft.retention_cents === Math.round(draft.earned_cents * 0.05), 'claim with 5% retention');
  const saved = run('save claim', S('claim', 'P-214', '--save'));
  assert(saved.saved && saved.number === 'PC-214-01', 'claim saved as PC-214-01');
  run('mark it submitted', S('claim-status', 'PC-214-01', '--submitted=today'));
  const sch = run('scheduled short', S('claim-status', 'PC-205-04', '--scheduled=12000'));
  assert(n(sch.scheduled_cents) === 1200000 && sch.status === 'scheduled', 'schedule recorded');
  const tonnes = run('tonnes', S('tonnes', '--weeks=6'));
  assert(tonnes.weeks.length === 6 && tonnes.weeks.some((x) => n(x.qa_t) > 0), 'six weeks of throughput');

  // ---- attention and compliance
  const att = run('attention', S('attention'));
  assert(att.length > 10 && att[0].area === 'traceability', 'attention leads with traceability');
  for (let i = 1; i < att.length; i++) assert(att[i].rank >= att[i - 1].rank, 'attention is ordered worst first');
  const comp = run('compliance', S('compliance'));
  assert(comp.length === 9, 'nine rules checked');
  assert(comp.find((c) => c.id === 'R1').count === 0, 'R1 clean once the certificate arrived');
  assert(comp.find((c) => c.id === 'R9').count === 0, 'R9 clean once the schedule arrived');
  assert(comp.find((c) => c.id === 'R2').count === 3, `three marks still untraced (${comp.find((c) => c.id === 'R2').count})`);

  // ---- import, export, log
  const dry = run('import dry run', S('import', 'tekla-powerfab', 'examples/powerfab-assembly-list.csv', '--project=P-218', '--dry-run'));
  assert(dry.marks === 5 && dry.problems.length === 1 && dry.created === 0, 'five marks parsed, the bad row skipped, nothing written');
  const imp = run('import', S('import', 'tekla-powerfab', 'examples/powerfab-assembly-list.csv', '--project=P-218'));
  assert(imp.created === 5, 'five marks created');
  const again = run('import again updates, not duplicates', S('import', 'tekla-powerfab', 'examples/powerfab-assembly-list.csv', '--project=P-218'));
  assert(again.created === 0 && again.updated === 5, 'second import updates');
  const c11 = run('imported mark card', S('mark', 'P-218', 'C11'));
  assert(n(c11.mark.unit_kg) === 402 && c11.mark.drawing_status === 'for-approval', 'imported with weight and drawing');
  run('log a note', S('log', 'P-218', 'Gareth', 'confirmed', 'the', 'canopy', 'crane', 'date'));
  const ex = run('export', S('export', `--out=${exportDir}`));
  assert(existsSync(path.join(exportDir, 'assemblies.csv')) && ex.counts.assemblies === 22, 'export wrote every table');
  assert(readFileSync(path.join(exportDir, 'material_lots.csv'), 'utf8').includes('24700'), 'export carries the new lot');

  // ---- views and documents render
  run('views render', ['view.mjs'], { json: false });
  run('documents render', ['docs.mjs'], { json: false });
  run('help', ['steel.mjs', 'help'], { json: false });
  run('unknown command exits 1', ['steel.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\nPASS: ${step} steps`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
