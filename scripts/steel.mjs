#!/usr/bin/env node
// steel-fabrication-for-claude-code: the one CLI. The slash commands call this; so can you.
//
//   node scripts/steel.mjs <command> [args] [--flags] [--json]
//   npm run steel -- <command> ...
//
// Run with no arguments (or `help`) for the command list.
//
// This records what a structural steel fabricator runs on every week: projects for builders,
// drawings and their revisions, erection sequences, piece marks and what each station has
// finished, heat lots and their mill certificates, which lot went into which mark, welders and
// their qualifications, inspections and NCRs, truck loads, and the progress claim. It sends
// nothing and talks to no other system: claims and dockets are drafted here, a person sends them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, truncate, heading, bar } from './lib/format.mjs';

// ---------------------------------------------------------------- arguments

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'save', 'open', 'no-cert', 'force']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name, value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const n = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const t3 = (v) => n(v).toFixed(1);

function today() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.toLowerCase() === 'today') return today();
  // NZ and AU exports write DD/MM/YYYY.
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const x = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(x)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(x * 100);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${isoDate(b)}T00:00:00`) - new Date(`${isoDate(a)}T00:00:00`)) / 86400000);
}

// Monday to Friday between two dates, the first excluded. Public holidays are not counted out:
// the Construction Contracts Act's working days also skip them, so treat this as the earliest date.
function workingDaysBetween(from, to) {
  let count = 0;
  const d = new Date(`${isoDate(from)}T00:00:00`);
  const end = new Date(`${isoDate(to)}T00:00:00`);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ---------------------------------------------------------------- lookups

let db;
let JSON_OUT = false;

function ambiguous(what, rows, label) {
  const lines = rows.map((r) => `  ${label(r)}`).join('\n');
  return new CliError(`More than one ${what} matches. Be more specific:\n${lines}`);
}

async function findProject(ref) {
  if (!ref || ref === true) throw new CliError('Which project? Give its code or part of its name.');
  const exact = await db.query(
    `select p.*, c.name as client from projects p join clients c on c.id = p.client_id
     where lower(p.code) = lower($1) or lower(coalesce(p.external_ref,'')) = lower($1) or p.id::text = $1`, [ref]);
  if (exact.length === 1) return exact[0];
  const fuzzy = await db.query(
    `select p.*, c.name as client from projects p join clients c on c.id = p.client_id
     where p.code ilike $1 or p.name ilike $1 or c.name ilike $1 or p.id::text like $2 order by p.code`, [`%${ref}%`, `${ref}%`]);
  if (fuzzy.length === 1) return fuzzy[0];
  if (!fuzzy.length) throw new CliError(`No project matches "${ref}". Run: steel projects`);
  throw ambiguous('project', fuzzy, (r) => `${r.code}  ${r.name} (${r.client})`);
}

async function findMark(projectRef, mark) {
  const p = await findProject(projectRef);
  if (!mark || mark === true) throw new CliError(`Which mark on ${p.code}? Run: steel marks --project=${p.code}`);
  const rows = await db.query(
    `select * from v_assembly_status where project_id = $1 and (lower(mark) = lower($2) or lower(coalesce(external_ref,'')) = lower($2))`,
    [p.id, mark]);
  if (rows.length === 1) return { project: p, mark: rows[0] };
  const fuzzy = await db.query(`select * from v_assembly_status where project_id = $1 and (mark ilike $2 or description ilike $2) order by mark`, [p.id, `%${mark}%`]);
  if (fuzzy.length === 1) return { project: p, mark: fuzzy[0] };
  if (!fuzzy.length) throw new CliError(`No mark "${mark}" on ${p.code}. Run: steel marks --project=${p.code}`);
  throw ambiguous('mark', fuzzy, (r) => `${r.mark}  ${r.description} (${r.stage})`);
}

async function findStaff(ref, role) {
  if (!ref || ref === true) throw new CliError(`Which ${role || 'person'}? Give a code or name.`);
  const rows = await db.query(
    `select * from staff where lower(code) = lower($1) or lower(full_name) = lower($1) or full_name ilike $2 order by full_name`, [ref, `%${ref}%`]);
  const exact = rows.filter((r) => r.code.toLowerCase() === String(ref).toLowerCase() || r.full_name.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No one called "${ref}". Run: steel welders`);
  throw ambiguous('person', rows, (r) => `${r.code}  ${r.full_name} (${r.role})`);
}

async function findLot(ref) {
  const rows = await db.query(`select * from material_lots where lower(lot_ref) = lower($1) or heat_no = $1 or lot_ref ilike $2 order by lot_ref`, [ref, `%${ref}%`]);
  const exact = rows.filter((r) => r.lot_ref.toLowerCase() === String(ref).toLowerCase() || r.heat_no === ref);
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No material lot or heat "${ref}". Run: steel lots`);
  throw ambiguous('lot', rows, (r) => `${r.lot_ref}  heat ${r.heat_no} ${r.profile}`);
}

async function findLoad(ref) {
  const rows = await db.query(`select l.*, p.code as project_code from loads l join projects p on p.id = l.project_id where lower(l.number) = lower($1) or l.number ilike $2 order by l.number`, [ref, `%${ref}%`]);
  const exact = rows.filter((r) => r.number.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No load "${ref}". Run: steel loads`);
  throw ambiguous('load', rows, (r) => `${r.number}  ${r.project_code}`);
}

// ---------------------------------------------------------------- output

function out(data, text) {
  if (JSON_OUT) console.log(JSON.stringify(data, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

// ---------------------------------------------------------------- reads

const ACCEPTED_QUALS = {
  CC1: ['AS/NZS 1554', 'AS/NZS 2980', 'ISO 9606-1'],
  CC2: ['AS/NZS 1554', 'AS/NZS 2980', 'ISO 9606-1'],
  CC3: ['AS/NZS 2980', 'ISO 9606-1'],
  CC4: ['AS/NZS 2980', 'ISO 9606-1'],
};

async function stats() {
  const [s] = await db.query(`
    select (select count(*) from projects where status = 'active') as active_projects,
           (select coalesce(sum(qty * unit_kg),0)/1000.0 from v_assembly_status v join projects p on p.id = v.project_id where p.status = 'active') as active_tonnes,
           (select coalesce(sum((qty - dispatched_qty) * unit_kg),0)/1000.0 from v_assembly_status v join projects p on p.id = v.project_id where p.status = 'active') as tonnes_to_ship,
           (select coalesce(sum(ready_qty * unit_kg),0)/1000.0 from v_assembly_status) as tonnes_ready,
           (select count(*) from ncrs where closed_on is null) as open_ncrs,
           (select count(*) from drawings where status in ('for-approval','on-hold')) as drawings_waiting,
           (select coalesce(sum(claimed_cents),0) from claims where status = 'submitted') as claims_out_cents`);
  const r = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, n(v)]));
  out(r, () => [
    heading('Kowhai at a glance'),
    `  ${r.active_projects} active projects, ${t3(r.active_tonnes)} t in the models, ${t3(r.tonnes_to_ship)} t still to ship.`,
    `  ${t3(r.tonnes_ready)} t finished and not on a truck. ${r.open_ncrs} open NCRs. ${r.drawings_waiting} drawings not released.`,
    `  ${money(r.claims_out_cents)} in claims submitted and not yet scheduled or paid.`,
  ].join('\n'));
}

async function projects(flags) {
  const rows = await db.query(`select * from v_project_tonnes where ($1::text is null or status = $1) order by code`, [flags.all ? null : (str(flags.status) || 'active')]);
  const data = rows.map((r) => ({
    code: r.code, name: r.name, client: r.client, category: r.construction_category, status: r.status, due_on: isoDate(r.due_on),
    model_t: +n(r.model_tonnes).toFixed(3), qa_t: +n(r.qa_tonnes).toFixed(3), dispatched_t: +n(r.dispatched_tonnes).toFixed(3),
    pct_dispatched: n(r.model_tonnes) ? Math.round((100 * n(r.dispatched_tonnes)) / n(r.model_tonnes)) : 0,
  }));
  out(data, () => heading('Projects') + '\n' + table(data, [
    { key: 'code', label: 'project' }, { key: 'name', label: 'name', width: 28 }, { key: 'client', label: 'builder', width: 24 },
    { key: 'category', label: 'cat' }, { key: 'model_t', label: 'model t', align: 'right', format: t3 },
    { key: 'qa_t', label: 'QA t', align: 'right', format: t3 }, { key: 'dispatched_t', label: 'sent t', align: 'right', format: t3 },
    { key: 'pct_dispatched', label: 'sent', format: (v) => `${bar(v)} ${v}%` }, { key: 'due_on', label: 'due' },
  ]));
}

async function project(args) {
  const p = await findProject(args[0]);
  const [tonnes] = await db.query(`select * from v_project_tonnes where project_id = $1`, [p.id]);
  const seqs = await sequenceRows(p.id);
  const drawings = await db.query(`select number, title, revision, status, issued_on, approved_on from drawings where project_id = $1 order by number`, [p.id]);
  const stages = await db.query(`select stage, count(*) as marks, sum(qty) as pieces, round(sum(qty*unit_kg)/1000.0, 3) as tonnes from v_assembly_status where project_id = $1 group by stage order by min(case stage when 'not started' then 0 when 'cutting' then 1 when 'fit-up' then 2 when 'welding' then 3 when 'awaiting QA' then 4 when 'at coating' then 5 when 'ready' then 6 else 7 end)`, [p.id]);
  const ncrs = await db.query(`select number, raised_on, description, closed_on from ncrs where project_id = $1 order by raised_on desc`, [p.id]);
  const claims = await db.query(`select number, period_end, claimed_cents, status, submitted_on from claims where project_id = $1 order by period_end`, [p.id]);
  const notes = await db.query(`select body, author, created_at from notes where project_id = $1 order by created_at desc limit 5`, [p.id]);
  const data = { project: p, tonnes, sequences: seqs, drawings, stages, ncrs, claims, notes };
  out(data, () => [
    heading(`${p.code}  ${p.name}`),
    `  Builder ${p.client}. Site ${p.site || 'not recorded'}. ${p.construction_category}. Coating: ${p.coating_spec || 'not recorded'}.`,
    `  Contract ${money(p.contract_value_cents)} for ${t3(p.contract_tonnes)} t. Model ${t3(tonnes.model_tonnes)} t, QA passed ${t3(tonnes.qa_tonnes)} t, dispatched ${t3(tonnes.dispatched_tonnes)} t. Due ${isoDate(p.due_on) || 'not set'}.`,
    '\nSequences', sequenceTable(seqs),
    '\nWhere the marks are', table(stages, [{ key: 'stage', label: 'stage' }, { key: 'marks', label: 'marks', align: 'right' }, { key: 'pieces', label: 'pieces', align: 'right' }, { key: 'tonnes', label: 't', align: 'right', format: t3 }]),
    '\nDrawings', table(drawings, [{ key: 'number', label: 'drawing' }, { key: 'title', label: 'title', width: 30 }, { key: 'revision', label: 'rev' }, { key: 'status', label: 'status' }, { key: 'issued_on', label: 'issued', format: isoDate }, { key: 'approved_on', label: 'approved', format: isoDate }]),
    '\nNCRs', table(ncrs, [{ key: 'number', label: 'ncr' }, { key: 'raised_on', label: 'raised', format: isoDate }, { key: 'description', label: 'what', width: 60 }, { key: 'closed_on', label: 'closed', format: (v) => (v ? isoDate(v) : 'OPEN') }]),
    '\nClaims', table(claims, [{ key: 'number', label: 'claim' }, { key: 'period_end', label: 'period end', format: isoDate }, { key: 'claimed_cents', label: 'claimed', align: 'right', format: money }, { key: 'status', label: 'status' }]),
    '\nNotes', notes.length ? notes.map((x) => `  ${isoDate(x.created_at)}  ${x.author || ''}: ${x.body}`).join('\n') : '  (none)',
  ].join('\n'));
}

async function drawings(flags) {
  const p = flags.project ? await findProject(flags.project) : null;
  const rows = await db.query(`
    select p.code as project, d.number, d.title, d.revision, d.status, d.issued_on, d.approved_on, d.approver,
           (current_date - d.issued_on) as days_out,
           (select count(*) from assemblies a where a.drawing_id = d.id) as marks
    from drawings d join projects p on p.id = d.project_id
    where ($1::uuid is null or d.project_id = $1) and ($2::text is null or d.status = $2) and p.status <> 'complete'
    order by p.code, d.number`, [p?.id ?? null, str(flags.status) || null]);
  out(rows, () => heading('Drawings') + '\n' + table(rows, [
    { key: 'project', label: 'project' }, { key: 'number', label: 'drawing' }, { key: 'title', label: 'title', width: 30 },
    { key: 'revision', label: 'rev' }, { key: 'status', label: 'status' }, { key: 'issued_on', label: 'issued', format: isoDate },
    { key: 'approved_on', label: 'approved', format: isoDate }, { key: 'marks', label: 'marks', align: 'right' },
    { key: 'days_out', label: 'days out', align: 'right', format: (v, r) => (r.status === 'for-approval' ? v : '') },
  ]));
}

// Fabrication against drawings that are not released, revisions after cutting, approvals waiting.
async function holdRows() {
  return db.query(`
    select v.project_code as project, v.mark, v.drawing_no as drawing, v.drawing_rev as rev, v.fabricated_rev, v.drawing_status, v.stage,
           case
             when v.drawing_status <> 'for-construction' and v.cut_qty > 0 then 'fabricating on a drawing that is ' || v.drawing_status
             when v.fabricated_rev is not null and v.fabricated_rev <> v.drawing_rev and v.cut_qty > 0 and v.dispatched_qty < v.qty then 'drawing went to rev ' || v.drawing_rev || ' after cutting to rev ' || v.fabricated_rev
           end as problem
    from v_assembly_status v join projects p on p.id = v.project_id
    where p.status = 'active' and v.cut_qty > 0
      and (v.drawing_status <> 'for-construction' or (v.fabricated_rev is not null and v.fabricated_rev <> v.drawing_rev and v.dispatched_qty < v.qty))
    order by v.project_code, v.mark`);
}

async function holds() {
  const rows = await holdRows();
  const waiting = await db.query(`
    select p.code as project, d.number as drawing, d.title, d.revision as rev, d.status, (current_date - d.issued_on) as days_out,
           (select min(sq.required_on) from assemblies a join sequences sq on sq.id = a.sequence_id where a.drawing_id = d.id) as needed_for
    from drawings d join projects p on p.id = d.project_id
    where d.status in ('for-approval','on-hold') and p.status = 'active' order by days_out desc`);
  out({ fabrication: rows, waiting }, () => [
    heading('Drawing holds'),
    'Work on the floor against a drawing that is not released, or that changed after cutting',
    table(rows, [{ key: 'project', label: 'project' }, { key: 'mark', label: 'mark' }, { key: 'drawing', label: 'drawing' }, { key: 'stage', label: 'stage' }, { key: 'problem', label: 'problem' }]),
    '\nDrawings waiting on someone else',
    table(waiting, [{ key: 'project', label: 'project' }, { key: 'drawing', label: 'drawing' }, { key: 'title', label: 'title', width: 30 }, { key: 'rev', label: 'rev' }, { key: 'status', label: 'status' }, { key: 'days_out', label: 'days out', align: 'right' }, { key: 'needed_for', label: 'site needs it', format: isoDate }]),
  ].join('\n'));
}

async function drawing(args, flags) {
  const p = await findProject(args[0]);
  const number = args[1];
  if (!number) throw new CliError('Which drawing number?');
  const [d] = await db.query(`select * from drawings where project_id = $1 and lower(number) = lower($2)`, [p.id, number]);
  const status = str(flags.status) || null;
  const rev = str(flags.rev) || null;
  const statuses = ['for-approval', 'approved', 'for-construction', 'on-hold', 'superseded'];
  if (status && !statuses.includes(status)) throw new CliError(`Status is one of: ${statuses.join(', ')}`);
  let row;
  if (!d) {
    [row] = await db.query(`insert into drawings (project_id, number, title, revision, status, issued_on) values ($1,$2,$3,coalesce($4,'A'),coalesce($5,'for-approval'),current_date) returning *`,
      [p.id, number, str(flags.title) || null, rev, status]);
  } else {
    [row] = await db.query(`update drawings set revision = coalesce($2, revision), status = coalesce($3, status), title = coalesce($4, title),
        issued_on = case when $2::text is not null and $2 <> revision then current_date else issued_on end,
        approved_on = case when $3::text in ('approved','for-construction') then coalesce(approved_on, current_date) when $2::text is not null and $2 <> revision then null else approved_on end,
        approver = coalesce($5, approver)
      where id = $1 returning *`, [d.id, rev, status, str(flags.title) || null, str(flags.by) || null]);
  }
  out(row, () => `  ${p.code} ${row.number} rev ${row.revision} is ${row.status}.`);
}

async function marks(flags) {
  const p = flags.project ? await findProject(flags.project) : null;
  const rows = await db.query(`
    select v.* from v_assembly_status v join projects p on p.id = v.project_id
    where ($1::uuid is null or v.project_id = $1) and ($2::text is null or lower(v.sequence_code) = lower($2)) and ($3::text is null or v.stage = $3)
      and ($1::uuid is not null or p.status = 'active')
    order by v.project_code, v.sequence_code, v.mark`, [p?.id ?? null, str(flags.sequence) || null, str(flags.stage) || null]);
  const data = rows.map((r) => ({ project: r.project_code, sequence: r.sequence_code, mark: r.mark, description: r.description, profile: r.main_profile, qty: r.qty, tonnes: n(r.tonnes), cut: r.cut_qty, fit: r.fit_qty, weld: r.weld_qty, qa: r.qa_qty, coat: r.coat_qty, sent: r.dispatched_qty, stage: r.stage }));
  out(data, () => heading('Piece marks') + '\n' + table(data, [
    { key: 'project', label: 'project' }, { key: 'sequence', label: 'seq' }, { key: 'mark', label: 'mark' }, { key: 'profile', label: 'profile' },
    { key: 'qty', label: 'qty', align: 'right' }, { key: 'tonnes', label: 't', align: 'right', format: t3 },
    { key: 'cut', label: 'cut', align: 'right' }, { key: 'fit', label: 'fit', align: 'right' }, { key: 'weld', label: 'weld', align: 'right' },
    { key: 'qa', label: 'qa', align: 'right' }, { key: 'coat', label: 'coat', align: 'right' }, { key: 'sent', label: 'sent', align: 'right' },
    { key: 'stage', label: 'stage' },
  ]));
}

async function mark(args) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  const moves = await db.query(`select ap.station, ap.qty, ap.done_on, s.full_name as by from assembly_progress ap left join staff s on s.id = ap.staff_id join stations st on st.code = ap.station where ap.assembly_id = $1 order by ap.done_on, st.ord`, [m.id]);
  const loads = await db.query(`select l.number, li.qty, l.planned_on, l.dispatched_on from load_items li join loads l on l.id = li.load_id where li.assembly_id = $1 order by l.planned_on`, [m.id]);
  out({ project: p.code, mark: m, moves, loads }, () => [
    heading(`${p.code} ${m.mark}  ${m.description || ''}`),
    `  ${m.qty} x ${m.main_profile} ${m.grade || ''}, ${n(m.unit_kg)} kg each, ${t3(m.tonnes)} t. ${m.weld_category} welds, ${m.coating}. Sequence ${m.sequence_code || '-'} needed ${isoDate(m.required_on) || 'unscheduled'}.`,
    `  Drawing ${m.drawing_no || '-'} rev ${m.drawing_rev || '-'} (${m.drawing_status || 'none'}). Stage: ${m.stage}. Ready to load: ${m.ready_qty}.`,
    '\nStations', table(moves, [{ key: 'done_on', label: 'date', format: isoDate }, { key: 'station', label: 'station' }, { key: 'qty', label: 'qty', align: 'right' }, { key: 'by', label: 'by' }]),
    '\nLoads', table(loads, [{ key: 'number', label: 'load' }, { key: 'qty', label: 'qty', align: 'right' }, { key: 'planned_on', label: 'planned', format: isoDate }, { key: 'dispatched_on', label: 'sent', format: (v) => (v ? isoDate(v) : 'not yet') }]),
    `\n  Full traceability: steel trace ${p.code} ${m.mark}`,
  ].join('\n'));
}

async function floor() {
  const rows = await db.query(`
    select stage, count(*) as marks, sum(qty) as pieces, round(sum(qty*unit_kg)/1000.0, 3) as tonnes, min(last_move) as oldest_move,
           string_agg(project_code || ' ' || mark, ', ' order by project_code, mark) as which
    from v_assembly_status v join projects p on p.id = v.project_id
    where p.status = 'active' and v.stage not in ('dispatched')
    group by stage
    order by min(case stage when 'not started' then 0 when 'cutting' then 1 when 'fit-up' then 2 when 'welding' then 3 when 'awaiting QA' then 4 when 'at coating' then 5 when 'ready' then 6 else 7 end)`);
  const stalled = await stalledRows();
  out({ stages: rows, stalled }, () => [
    heading('The floor'),
    table(rows, [{ key: 'stage', label: 'stage' }, { key: 'marks', label: 'marks', align: 'right' }, { key: 'pieces', label: 'pieces', align: 'right' }, { key: 'tonnes', label: 't', align: 'right', format: t3 }, { key: 'oldest_move', label: 'oldest move', format: isoDate }, { key: 'which', label: 'which', width: 60 }]),
    '\nStalled: started, unfinished, nothing moved for 7 days or more',
    table(stalled, [{ key: 'project', label: 'project' }, { key: 'mark', label: 'mark' }, { key: 'stage', label: 'stage' }, { key: 'last_move', label: 'last move', format: isoDate }, { key: 'days', label: 'days', align: 'right' }]),
  ].join('\n'));
}

async function stalledRows(days = 7) {
  return db.query(`
    select project_code as project, mark, stage, last_move, (current_date - last_move) as days
    from v_assembly_status v join projects p on p.id = v.project_id
    where p.status = 'active' and v.cut_qty > 0 and v.stage not in ('ready','dispatched') and v.last_move <= current_date - $1::int
    order by last_move`, [days]);
}

async function progress(args, flags) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  const station = String(args[2] || '').toLowerCase();
  const stations = (await db.query(`select code from stations order by ord`)).map((r) => r.code);
  if (!stations.includes(station)) throw new CliError(`Station is one of: ${stations.join(', ')}`);
  const doneCol = { cut: 'cut_qty', fit: 'fit_qty', weld: 'weld_qty', qa: 'qa_qty', coat: 'coat_qty' }[station];
  const left = m.qty - n(m[doneCol]);
  const qty = flags.qty ? Number(flags.qty) : left;
  if (!Number.isInteger(qty) || qty <= 0) throw new CliError(`${m.mark} has ${left} of ${m.qty} left at ${station}. Give --qty as a whole number.`);
  if (qty > left) throw new CliError(`${m.mark} only has ${left} of ${m.qty} left at ${station}.`);
  const prev = stations[stations.indexOf(station) - 1];
  if (prev) {
    const prevDone = n(m[{ cut: 'cut_qty', fit: 'fit_qty', weld: 'weld_qty', qa: 'qa_qty', coat: 'coat_qty' }[prev]]);
    if (n(m[doneCol]) + qty > prevDone) throw new CliError(`Only ${prevDone} of ${m.mark} have been through ${prev}. Record ${prev} first.`);
  }
  if (station === 'cut' && m.drawing_status && m.drawing_status !== 'for-construction' && !flags.force)
    throw new CliError(`${m.drawing_no} is ${m.drawing_status}, not for construction. Cutting to it is the risk the hold exists for. Add --force if the builder has told you in writing to proceed.`);
  if (station === 'coat' && m.weld_category !== 'none') {
    const [v] = await db.query(`select count(*) as c from inspections where assembly_id = $1 and kind = 'visual' and result = 'pass'`, [m.id]);
    if (!n(v.c) && !flags.force) throw new CliError(`${m.mark} has no passed visual weld inspection. Record it first (steel inspect ${p.code} ${m.mark} --kind=visual --result=pass), or add --force.`);
  }
  const by = flags.by ? await findStaff(flags.by) : null;
  const on = parseDate(flags.on) || today();
  await db.query(`insert into assembly_progress (assembly_id, station, qty, done_on, staff_id) values ($1,$2,$3,$4,$5)
    on conflict (assembly_id, station, done_on) do update set qty = assembly_progress.qty + excluded.qty`, [m.id, station, qty, on, by?.id ?? null]);
  if (station === 'cut' && !m.fabricated_rev) await db.query(`update assemblies set fabricated_rev = $2 where id = $1`, [m.id, m.drawing_rev]);
  const { mark: after } = await findMark(p.code, m.mark);
  out({ project: p.code, mark: after.mark, station, qty, stage: after.stage }, () => `  ${p.code} ${after.mark}: ${qty} through ${station}. Now ${after.stage}.`);
}

async function sequenceRows(projectId = null) {
  return db.query(`
    select v.project_code as project, v.sequence_code as sequence, sq.name, sq.required_on,
           (sq.required_on - current_date) as days_to_go,
           round(sum(v.qty*v.unit_kg)/1000.0, 3) as tonnes,
           round(sum(v.finished_qty*v.unit_kg)/1000.0, 3) as finished_t,
           round(sum(v.dispatched_qty*v.unit_kg)/1000.0, 3) as dispatched_t,
           count(*) filter (where v.stage not in ('ready','dispatched')) as marks_not_ready,
           string_agg(case when v.stage not in ('ready','dispatched') then v.mark || ' ' || v.stage end, ', ' order by v.mark) as behind
    from v_assembly_status v join sequences sq on sq.id = v.sequence_id join projects p on p.id = v.project_id
    where ($1::uuid is null or v.project_id = $1) and p.status = 'active'
    group by v.project_code, v.sequence_code, sq.name, sq.required_on
    order by sq.required_on`, [projectId]);
}

function seqRisk(r) {
  if (n(r.dispatched_t) >= n(r.tonnes)) return 'sent';
  if (n(r.days_to_go) < 0) return 'LATE';
  if (n(r.days_to_go) <= 7 && n(r.marks_not_ready) > 0) return 'at risk';
  return 'on track';
}

function sequenceTable(rows) {
  return table(rows.map((r) => ({ ...r, risk: seqRisk(r) })), [
    { key: 'project', label: 'project' }, { key: 'sequence', label: 'seq' }, { key: 'name', label: 'name', width: 22 },
    { key: 'required_on', label: 'site needs', format: isoDate }, { key: 'days_to_go', label: 'days', align: 'right' },
    { key: 'tonnes', label: 't', align: 'right', format: t3 }, { key: 'finished_t', label: 'finished t', align: 'right', format: t3 },
    { key: 'dispatched_t', label: 'sent t', align: 'right', format: t3 }, { key: 'risk', label: 'risk' }, { key: 'behind', label: 'not ready', width: 50 },
  ]);
}

async function sequences(flags) {
  const p = flags.project ? await findProject(flags.project) : null;
  const rows = (await sequenceRows(p?.id ?? null)).map((r) => ({ ...r, risk: seqRisk(r) }));
  out(rows, () => heading('Erection sequences against site dates') + '\n' + sequenceTable(rows));
}

async function ready(flags) {
  const p = flags.project ? await findProject(flags.project) : null;
  const rows = await db.query(`
    select project_code as project, sequence_code as sequence, required_on, mark, description, ready_qty, unit_kg,
           round(ready_qty*unit_kg/1000.0, 3) as tonnes
    from v_assembly_status where ready_qty > 0 and ($1::uuid is null or project_id = $1)
    order by required_on nulls last, project_code, mark`, [p?.id ?? null]);
  out(rows, () => heading('Finished and not on a truck') + '\n' + table(rows, [
    { key: 'project', label: 'project' }, { key: 'sequence', label: 'seq' }, { key: 'required_on', label: 'site needs', format: isoDate },
    { key: 'mark', label: 'mark' }, { key: 'description', label: 'description', width: 30 }, { key: 'ready_qty', label: 'qty', align: 'right' },
    { key: 'tonnes', label: 't', align: 'right', format: t3 },
  ]) + `\n  ${t3(rows.reduce((s, r) => s + n(r.tonnes), 0))} t ready in total.`);
}

// ---------------------------------------------------------------- loads

async function loads(flags) {
  const rows = await db.query(`
    select l.number, p.code as project, l.carrier, l.planned_on, l.dispatched_on, l.notes,
           count(li.id) as lines, coalesce(sum(li.qty),0) as pieces, round(coalesce(sum(li.qty*a.unit_kg),0)/1000.0, 3) as tonnes
    from loads l join projects p on p.id = l.project_id
    left join load_items li on li.load_id = l.id left join assemblies a on a.id = li.assembly_id
    where ($1::boolean is not true or l.dispatched_on is null)
    group by l.id, p.code order by l.planned_on desc nulls first`, [flags.open === true]);
  out(rows, () => heading(flags.open ? 'Open loads' : 'Loads') + '\n' + table(rows, [
    { key: 'number', label: 'load' }, { key: 'project', label: 'project' }, { key: 'carrier', label: 'carrier' },
    { key: 'planned_on', label: 'planned', format: isoDate }, { key: 'dispatched_on', label: 'sent', format: (v) => (v ? isoDate(v) : 'not yet') },
    { key: 'pieces', label: 'pieces', align: 'right' }, { key: 'tonnes', label: 't', align: 'right', format: t3 }, { key: 'notes', label: 'notes', width: 40 },
  ]));
}

async function loadNew(args, flags) {
  const p = await findProject(args[0]);
  const [{ next }] = await db.query(`select 'L-' || lpad((coalesce(max(nullif(regexp_replace(number, '[^0-9]', '', 'g'), '')::int), 1000) + 1)::text, 4, '0') as next from loads`);
  const number = str(flags.number) || next;
  const [row] = await db.query(`insert into loads (number, project_id, carrier, planned_on, notes) values ($1,$2,$3,$4,$5) returning *`,
    [number, p.id, str(flags.carrier) || null, parseDate(flags.planned) || today(), str(flags.notes) || null]);
  out(row, () => `  Load ${row.number} for ${p.code} planned ${isoDate(row.planned_on)}. Add marks: steel load-add ${row.number} <mark> [--qty=N]`);
}

async function loadAdd(args, flags) {
  const l = await findLoad(args[0]);
  if (l.dispatched_on) throw new CliError(`${l.number} already left on ${isoDate(l.dispatched_on)}.`);
  const { mark: m } = await findMark(l.project_code, args[1]);
  const qty = flags.qty ? Number(flags.qty) : m.ready_qty;
  if (!Number.isInteger(qty) || qty <= 0) throw new CliError(`${m.mark} has ${m.ready_qty} finished and not loaded.`);
  if (qty > m.ready_qty && !flags.force) throw new CliError(`${m.mark} has only ${m.ready_qty} finished and not loaded (stage: ${m.stage}). Add --force to load unfinished steel.`);
  await db.query(`insert into load_items (load_id, assembly_id, qty) values ($1,$2,$3) on conflict (load_id, assembly_id) do update set qty = load_items.qty + excluded.qty`, [l.id, m.id, qty]);
  out({ load: l.number, mark: m.mark, qty }, () => `  ${qty} x ${m.mark} on ${l.number}.`);
}

async function dispatch(args, flags) {
  const l = await findLoad(args[0]);
  if (l.dispatched_on) throw new CliError(`${l.number} already left on ${isoDate(l.dispatched_on)}.`);
  const [{ c }] = await db.query(`select count(*) as c from load_items where load_id = $1`, [l.id]);
  if (!n(c)) throw new CliError(`${l.number} is empty.`);
  const on = parseDate(flags.on) || today();
  await db.query(`update loads set dispatched_on = $2 where id = $1`, [l.id, on]);
  out({ load: l.number, dispatched_on: on }, () => `  ${l.number} dispatched ${on}. Docket: npm run docs -- docket ${l.number}`);
}

// ---------------------------------------------------------------- material

async function lots(flags) {
  const rows = await db.query(`
    select l.lot_ref, l.heat_no, l.profile, l.grade, l.supplier, l.cert_ref, l.cert_received, l.received_on, l.qty,
           string_agg(p.code || ' ' || a.mark, ', ' order by p.code, a.mark) as used_in
    from material_lots l
    left join allocations al on al.lot_id = l.id left join assemblies a on a.id = al.assembly_id left join projects p on p.id = a.project_id
    where ($1::boolean is not true or not l.cert_received)
    group by l.id order by l.received_on desc nulls last`, [flags['no-cert'] === true]);
  out(rows, () => heading('Material lots and heat numbers') + '\n' + table(rows, [
    { key: 'lot_ref', label: 'lot' }, { key: 'heat_no', label: 'heat' }, { key: 'profile', label: 'profile' }, { key: 'grade', label: 'grade' },
    { key: 'supplier', label: 'supplier' }, { key: 'received_on', label: 'received', format: isoDate },
    { key: 'cert_received', label: 'mill cert', format: (v, r) => (v ? r.cert_ref || 'yes' : 'MISSING') }, { key: 'used_in', label: 'used in', width: 40 },
  ]));
}

async function receive(args, flags) {
  const lotRef = args[0];
  if (!lotRef) throw new CliError('Give the lot reference, then --profile, --heat and --cert if the mill certificate came with it.');
  if (!flags.profile) throw new CliError('Which profile? --profile=310UC137');
  const cert = str(flags.cert) || null;
  const [row] = await db.query(`insert into material_lots (lot_ref, heat_no, profile, grade, supplier, cert_ref, cert_received, received_on, length_m, qty)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict (lot_ref) do update set cert_ref = coalesce(excluded.cert_ref, material_lots.cert_ref), cert_received = material_lots.cert_received or excluded.cert_received
    returning *`, [lotRef, str(flags.heat) || null, str(flags.profile), str(flags.grade) || null, str(flags.supplier) || null, cert, !!cert,
    parseDate(flags.on) || today(), flags.length ? Number(flags.length) : null, flags.qty ? Number(flags.qty) : 1]);
  out(row, () => `  ${row.lot_ref} heat ${row.heat_no || '-'} ${row.profile}: ${row.cert_received ? 'mill certificate ' + (row.cert_ref || 'on file') : 'NO mill certificate yet'}.`);
}

async function allocate(args) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  if (!args[2]) throw new CliError('Which lot or heat number?');
  const lot = await findLot(args[2]);
  await db.query(`insert into allocations (assembly_id, lot_id) values ($1,$2) on conflict (assembly_id, lot_id) do nothing`, [m.id, lot.id]);
  const warn = lot.cert_received ? '' : ' Warning: that lot has no mill certificate on file.';
  const prof = lot.profile !== m.main_profile ? ` Note: lot is ${lot.profile}, the mark's main member is ${m.main_profile}.` : '';
  out({ project: p.code, mark: m.mark, lot: lot.lot_ref, heat: lot.heat_no, cert: lot.cert_received }, () => `  ${p.code} ${m.mark} traced to ${lot.lot_ref} (heat ${lot.heat_no}).${warn}${prof}`);
}

async function trace(args) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  const lotsUsed = await db.query(`select l.lot_ref, l.heat_no, l.profile, l.grade, l.supplier, l.cert_ref, l.cert_received from allocations al join material_lots l on l.id = al.lot_id where al.assembly_id = $1 order by l.lot_ref`, [m.id]);
  const welds = await db.query(`
    select w.welded_on, w.welder_id, s.code as welder_code, s.full_name as welder, wp.code as wps,
           (select string_agg(q.standard || ' ' || q.qual_status, '; ') from v_welder_status q where q.staff_id = s.id) as quals
    from weld_records w join staff s on s.id = w.welder_id left join wps wp on wp.id = w.wps_id where w.assembly_id = $1 order by w.welded_on`, [m.id]);
  const insp = await db.query(`select inspected_on, kind, result, inspector, reading from inspections where assembly_id = $1 order by inspected_on`, [m.id]);
  const ncr = await db.query(`select number, raised_on, description, disposition, closed_on from ncrs where assembly_id = $1 order by raised_on`, [m.id]);
  const gaps = [];
  const cc = p.construction_category;
  if (!lotsUsed.length && (m.main_member ? cc !== 'CC1' : ['CC3', 'CC4'].includes(cc))) gaps.push(`no heat lot recorded (${cc} needs lot traceability for this item)`);
  for (const l of lotsUsed) if (!l.cert_received) gaps.push(`lot ${l.lot_ref} has no mill certificate`);
  if (['CC3', 'CC4'].includes(cc) && m.weld_qty > 0 && !welds.length) gaps.push(`${cc} needs welder and procedure traceability, none recorded`);
  if (m.weld_category !== 'none' && m.qa_qty > 0 && !insp.some((i) => i.kind === 'visual' && i.result === 'pass')) gaps.push('QA passed with no visual weld inspection recorded');
  const qualifiedOn = await qualifiedCheck();
  for (const w of welds) if (!qualifiedOn({ ...w, cc, welder_id: w.welder_id })) gaps.push(`${w.welder} was not qualified for ${cc} on ${isoDate(w.welded_on)}`);
  for (const i of insp) if (i.result === 'fail' && !insp.some((j) => j.kind === i.kind && j.result === 'pass' && isoDate(j.inspected_on) > isoDate(i.inspected_on))) gaps.push(`${i.kind} failed ${isoDate(i.inspected_on)} with no later pass`);
  for (const x of ncr) if (!x.closed_on) gaps.push(`${x.number} is open`);
  if (m.drawing_status && m.drawing_status !== 'for-construction') gaps.push(`drawing ${m.drawing_no} is ${m.drawing_status}`);
  out({ project: p.code, category: cc, mark: m, lots: lotsUsed, welds, inspections: insp, ncrs: ncr, gaps }, () => [
    heading(`Trace ${p.code} ${m.mark} (${cc})`),
    '\nMaterial', table(lotsUsed, [{ key: 'lot_ref', label: 'lot' }, { key: 'heat_no', label: 'heat' }, { key: 'profile', label: 'profile' }, { key: 'grade', label: 'grade' }, { key: 'supplier', label: 'supplier' }, { key: 'cert_ref', label: 'mill cert', format: (v, r) => (r.cert_received ? v : 'MISSING') }]),
    '\nWelding', table(welds, [{ key: 'welded_on', label: 'date', format: isoDate }, { key: 'welder', label: 'welder' }, { key: 'wps', label: 'WPS' }, { key: 'quals', label: 'qualification today' }]),
    '\nInspections', table(insp, [{ key: 'inspected_on', label: 'date', format: isoDate }, { key: 'kind', label: 'test' }, { key: 'result', label: 'result' }, { key: 'inspector', label: 'by' }, { key: 'reading', label: 'reading', width: 40 }]),
    '\nNCRs', table(ncr, [{ key: 'number', label: 'ncr' }, { key: 'description', label: 'what', width: 60 }, { key: 'closed_on', label: 'closed', format: (v) => (v ? isoDate(v) : 'OPEN') }]),
    '\nGaps', gaps.length ? gaps.map((g) => `  - ${g}`).join('\n') : '  None. This mark can be signed off.',
  ].join('\n'));
}

// ---------------------------------------------------------------- welding and quality

async function welders() {
  const rows = await db.query(`
    select q.staff_code as code, q.full_name, q.standard, q.process, q.position, q.qualified_on, q.confirmed_on, q.confirm_by, q.expires_on, q.qual_status,
           (select max(welded_on) from weld_records w where w.welder_id = q.staff_id) as last_weld
    from v_welder_status q where q.active order by case q.qual_status when 'expired' then 0 when 'confirmation overdue' then 1 when 'expires soon' then 2 else 3 end, q.full_name`);
  out(rows, () => heading('Welder qualifications') + '\n' + table(rows, [
    { key: 'full_name', label: 'welder' }, { key: 'standard', label: 'standard' }, { key: 'process', label: 'process' }, { key: 'position', label: 'pos' },
    { key: 'qualified_on', label: 'qualified', format: isoDate }, { key: 'confirm_by', label: 'confirm by', format: (v, r) => (r.standard === 'ISO 9606-1' ? isoDate(v) : '') },
    { key: 'expires_on', label: 'expires', format: isoDate }, { key: 'qual_status', label: 'status' }, { key: 'last_weld', label: 'last weld', format: isoDate },
  ]));
}

async function confirmWelder(args, flags) {
  const s = await findStaff(args[0], 'welder');
  const std = str(flags.standard) || null;
  const rows = await db.query(`update welder_quals set confirmed_on = $2 where staff_id = $1 and ($3::text is null or standard = $3) and standard = 'ISO 9606-1' returning *`, [s.id, parseDate(flags.on) || today(), std]);
  if (!rows.length) throw new CliError(`${s.full_name} has no ISO 9606-1 qualification to confirm.`);
  out(rows, () => `  ${s.full_name}: ISO 9606-1 confirmation recorded ${isoDate(rows[0].confirmed_on)}. Next due in six months.`);
}

async function weld(args, flags) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  const w = await findStaff(flags.welder, 'welder');
  const wpsRow = flags.wps ? (await db.query(`select * from wps where lower(code) = lower($1)`, [str(flags.wps)]))[0] : null;
  if (flags.wps && !wpsRow) throw new CliError(`No weld procedure "${flags.wps}". Known: ${(await db.query('select code from wps order by code')).map((r) => r.code).join(', ')}`);
  const quals = await db.query(`select * from v_welder_status where staff_id = $1`, [w.id]);
  const ok = quals.filter((q) => q.qual_status !== 'expired' && q.qual_status !== 'confirmation overdue' && ACCEPTED_QUALS[p.construction_category].includes(q.standard));
  const on = parseDate(flags.on) || today();
  await db.query(`insert into weld_records (assembly_id, welder_id, wps_id, welded_on) values ($1,$2,$3,$4) on conflict (assembly_id, welder_id, welded_on) do update set wps_id = coalesce(excluded.wps_id, weld_records.wps_id)`, [m.id, w.id, wpsRow?.id ?? null, on]);
  const warn = ok.length ? '' : ` Warning: ${w.full_name} has no current qualification accepted at ${p.construction_category} (${quals.map((q) => `${q.standard} ${q.qual_status}`).join('; ') || 'none on file'}).`;
  out({ project: p.code, mark: m.mark, welder: w.full_name, wps: wpsRow?.code ?? null, qualified: ok.length > 0 }, () => `  ${p.code} ${m.mark} welded by ${w.full_name}${wpsRow ? ' to ' + wpsRow.code : ''}.${warn}`);
}

async function inspect(args, flags) {
  const { project: p, mark: m } = await findMark(args[0], args[1]);
  const kinds = ['visual', 'dimensional', 'mpi', 'ut', 'dft', 'hold-point'];
  const kind = str(flags.kind).toLowerCase();
  if (!kinds.includes(kind)) throw new CliError(`--kind is one of: ${kinds.join(', ')}`);
  const result = str(flags.result).toLowerCase() || 'pass';
  if (!['pass', 'fail', 'pending'].includes(result)) throw new CliError('--result is pass, fail or pending');
  const on = parseDate(flags.on) || today();
  await db.query(`insert into inspections (assembly_id, kind, result, inspected_on, inspector, reading, notes) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (assembly_id, kind, inspected_on) do update set result = excluded.result, inspector = excluded.inspector, reading = excluded.reading, notes = excluded.notes`,
  [m.id, kind, result, on, str(flags.by) || null, str(flags.reading) || null, str(flags.notes) || null]);
  let ncrNo = null;
  if (result === 'fail') {
    ncrNo = await nextNcr();
    await db.query(`insert into ncrs (number, project_id, assembly_id, description) values ($1,$2,$3,$4)`, [ncrNo, p.id, m.id, `${kind.toUpperCase()} failed on ${m.mark}${flags.reading ? ': ' + flags.reading : ''}`]);
  }
  out({ project: p.code, mark: m.mark, kind, result, ncr: ncrNo }, () => `  ${p.code} ${m.mark}: ${kind} ${result}.${ncrNo ? ` ${ncrNo} raised. Close it with: steel close-ncr ${ncrNo} --disposition=repair` : ''}`);
}

async function nextNcr() {
  const [{ next }] = await db.query(`select 'NCR-' || lpad((coalesce(max(nullif(regexp_replace(number, '[^0-9]', '', 'g'), '')::int), 0) + 1)::text, 3, '0') as next from ncrs`);
  return next;
}

async function ncrs(flags) {
  const rows = await db.query(`
    select n.number, p.code as project, a.mark, n.raised_on, (current_date - n.raised_on) as age, n.description, n.disposition, n.closed_on
    from ncrs n join projects p on p.id = n.project_id left join assemblies a on a.id = n.assembly_id
    where ($1::boolean is not true or n.closed_on is null) order by n.closed_on nulls first, n.raised_on`, [flags.open === true]);
  out(rows, () => heading('Non-conformance reports') + '\n' + table(rows, [
    { key: 'number', label: 'ncr' }, { key: 'project', label: 'project' }, { key: 'mark', label: 'mark' }, { key: 'raised_on', label: 'raised', format: isoDate },
    { key: 'age', label: 'days', align: 'right', format: (v, r) => (r.closed_on ? '' : v) }, { key: 'description', label: 'what', width: 60 },
    { key: 'disposition', label: 'disposition' }, { key: 'closed_on', label: 'closed', format: (v) => (v ? isoDate(v) : 'OPEN') },
  ]));
}

async function ncr(args, flags) {
  const p = await findProject(args[0]);
  const m = args[1] ? (await findMark(p.code, args[1])).mark : null;
  if (!flags.description) throw new CliError('Describe the problem: --description="..."');
  const number = await nextNcr();
  await db.query(`insert into ncrs (number, project_id, assembly_id, description) values ($1,$2,$3,$4)`, [number, p.id, m?.id ?? null, str(flags.description)]);
  out({ number }, () => `  ${number} raised on ${p.code}${m ? ' ' + m.mark : ''}.`);
}

async function closeNcr(args, flags) {
  const disp = str(flags.disposition);
  if (!['rework', 'repair', 'use-as-is', 'scrap'].includes(disp)) throw new CliError('--disposition is rework, repair, use-as-is or scrap');
  const rows = await db.query(`update ncrs set disposition = $2, closed_on = $3 where lower(number) = lower($1) and closed_on is null returning *`, [args[0], disp, parseDate(flags.on) || today()]);
  if (!rows.length) throw new CliError(`No open NCR "${args[0]}". Run: steel ncrs --open`);
  out(rows[0], () => `  ${rows[0].number} closed: ${disp}.`);
}

// ---------------------------------------------------------------- throughput and money

async function tonnes(flags) {
  const weeks = Number(flags.weeks || 8);
  const rows = await db.query(`
    with w as (select generate_series(date_trunc('week', current_date) - make_interval(weeks => $1::int - 1), date_trunc('week', current_date), interval '1 week')::date as week)
    select w.week,
           coalesce((select round(sum(ap.qty*a.unit_kg)/1000.0, 3) from assembly_progress ap join assemblies a on a.id = ap.assembly_id where ap.station = 'cut' and ap.done_on >= w.week and ap.done_on < w.week + 7),0) as cut_t,
           coalesce((select round(sum(ap.qty*a.unit_kg)/1000.0, 3) from assembly_progress ap join assemblies a on a.id = ap.assembly_id where ap.station = 'qa' and ap.done_on >= w.week and ap.done_on < w.week + 7),0) as qa_t,
           coalesce((select round(sum(li.qty*a.unit_kg)/1000.0, 3) from load_items li join loads l on l.id = li.load_id join assemblies a on a.id = li.assembly_id where l.dispatched_on >= w.week and l.dispatched_on < w.week + 7),0) as dispatched_t
    from w order by w.week`, [weeks]);
  const avg = rows.length ? rows.reduce((s, r) => s + n(r.qa_t), 0) / rows.length : 0;
  out({ weeks: rows, average_qa_tonnes: +avg.toFixed(3) }, () => heading(`Tonnes through the shop, last ${weeks} weeks`) + '\n' + table(rows, [
    { key: 'week', label: 'week of', format: isoDate }, { key: 'cut_t', label: 'cut t', align: 'right', format: t3 },
    { key: 'qa_t', label: 'QA passed t', align: 'right', format: t3 }, { key: 'qa_t', label: '', format: (v) => bar((n(v) / Math.max(avg * 2, 1)) * 100, 20) },
    { key: 'dispatched_t', label: 'sent t', align: 'right', format: t3 },
  ]) + `\n  Average ${t3(avg)} t a week through QA.`);
}

// Earned value: a mark earns fabricated_pct of its share of the contract when it passes QA,
// the rest when it leaves on a truck. Share = contract value x the mark's tonnes / contract tonnes.
async function earned(p, periodEnd) {
  const [r] = await db.query(`
    with q as (
      select a.id, a.unit_kg,
             least(coalesce((select sum(qty) from assembly_progress ap where ap.assembly_id = a.id and ap.station = 'qa' and ap.done_on <= $2), 0), a.qty) as qa,
             least(coalesce((select sum(li.qty) from load_items li join loads l on l.id = li.load_id where li.assembly_id = a.id and l.dispatched_on <= $2), 0), a.qty) as sent
      from assemblies a where a.project_id = $1)
    select coalesce(sum(qa*unit_kg),0)/1000.0 as qa_t, coalesce(sum(sent*unit_kg),0)/1000.0 as sent_t from q`, [p.id, periodEnd]);
  const rate = n(p.contract_tonnes) ? n(p.contract_value_cents) / n(p.contract_tonnes) : 0;
  const f = n(p.fabricated_pct) / 100;
  const qaOnly = Math.max(n(r.qa_t) - n(r.sent_t), 0);
  const value = Math.min(Math.round(rate * (qaOnly * f + n(r.sent_t))), n(p.contract_value_cents));
  return { qa_t: n(r.qa_t), sent_t: n(r.sent_t), rate_per_t_cents: Math.round(rate), earned_cents: value };
}

async function claim(args, flags) {
  const p = await findProject(args[0]);
  const periodEnd = parseDate(flags['period-end']) || today();
  const e = await earned(p, periodEnd);
  const [prev] = await db.query(`select coalesce(sum(claimed_cents),0) as c, count(*) as k from claims where project_id = $1 and period_end < $2`, [p.id, periodEnd]);
  const retention = Math.round((e.earned_cents * n(p.retention_pct)) / 100);
  const thisClaim = e.earned_cents - retention - n(prev.c);
  const [{ k }] = await db.query(`select count(*) + 1 as k from claims where project_id = $1`, [p.id]);
  const number = `PC-${p.code.replace(/^P-/, '')}-${String(k).padStart(2, '0')}`;
  const draft = { number, project: p.code, period_end: periodEnd, ...e, retention_cents: retention, previous_cents: n(prev.c), claimed_cents: thisClaim };
  if (flags.save) {
    if (thisClaim <= 0) throw new CliError('Nothing new has been earned since the last claim.');
    await db.query(`insert into claims (number, project_id, period_end, earned_cents, previous_cents, retention_cents, claimed_cents) values ($1,$2,$3,$4,$5,$6,$7)`,
      [number, p.id, periodEnd, e.earned_cents, n(prev.c), retention, thisClaim]);
    draft.saved = true;
  }
  out(draft, () => [
    heading(`Progress claim ${number}  ${p.code} ${p.name}`),
    `  Period ending ${periodEnd}. Contract ${money(p.contract_value_cents)} for ${t3(p.contract_tonnes)} t, ${money(e.rate_per_t_cents)} a tonne.`,
    `  QA passed ${t3(e.qa_t)} t (earns ${n(p.fabricated_pct)}%), dispatched ${t3(e.sent_t)} t (earns 100%).`,
    `  Earned to date        ${money(e.earned_cents).padStart(12)}`,
    `  Less retention ${String(n(p.retention_pct)).padStart(4)}%  ${money(retention).padStart(12)}`,
    `  Less claimed before   ${money(n(prev.c)).padStart(12)}`,
    `  This claim            ${money(thisClaim).padStart(12)}  (plus GST)`,
    flags.save ? `\n  Saved as a draft. Render it: npm run docs -- claim ${number}. Mark it sent: steel claim-status ${number} --submitted=today` : '\n  Not saved. Add --save to keep it as a draft.',
  ].join('\n'));
}

async function claimRows() {
  const rows = await db.query(`
    select c.number, p.code as project, p.name, cl.name as client, p.payment_days, c.period_end, c.claimed_cents, c.status, c.submitted_on, c.scheduled_cents, c.scheduled_on, c.paid_on
    from claims c join projects p on p.id = c.project_id join clients cl on cl.id = p.client_id order by c.period_end`);
  const t = today();
  return rows.map((r) => {
    const wd = r.submitted_on ? workingDaysBetween(r.submitted_on, t) : null;
    const scheduleLate = r.status === 'submitted' && wd !== null && wd > n(r.payment_days);
    return { ...r, working_days_out: wd, schedule_late: scheduleLate };
  });
}

async function claims(flags) {
  let rows = await claimRows();
  if (flags.open) rows = rows.filter((r) => r.status !== 'paid');
  out(rows, () => heading('Progress claims') + '\n' + table(rows, [
    { key: 'number', label: 'claim' }, { key: 'project', label: 'project' }, { key: 'client', label: 'builder', width: 24 },
    { key: 'period_end', label: 'period end', format: isoDate }, { key: 'claimed_cents', label: 'claimed', align: 'right', format: money },
    { key: 'status', label: 'status' }, { key: 'submitted_on', label: 'submitted', format: isoDate },
    { key: 'working_days_out', label: 'working days', align: 'right', format: (v, r) => (r.status === 'submitted' ? v : '') },
    { key: 'schedule_late', label: '', format: (v) => (v ? 'NO SCHEDULE IN TIME' : '') },
  ]));
}

async function claimStatus(args, flags) {
  const [c] = await db.query(`select * from claims where lower(number) = lower($1)`, [args[0]]);
  if (!c) throw new CliError(`No claim "${args[0]}". Run: steel claims`);
  let row;
  if (flags.submitted) [row] = await db.query(`update claims set status = 'submitted', submitted_on = $2 where id = $1 returning *`, [c.id, parseDate(flags.submitted)]);
  else if (flags.scheduled) [row] = await db.query(`update claims set status = 'scheduled', scheduled_cents = $2, scheduled_on = $3 where id = $1 returning *`, [c.id, parseMoney(flags.scheduled), parseDate(flags.on) || today()]);
  else if (flags.paid) [row] = await db.query(`update claims set status = 'paid', paid_on = $2 where id = $1 returning *`, [c.id, parseDate(flags.paid)]);
  else throw new CliError('Give --submitted=<date>, --scheduled=<amount> [--on=<date>] or --paid=<date>.');
  const short = row.scheduled_cents != null && n(row.scheduled_cents) < n(row.claimed_cents) ? ` Scheduled ${money(n(row.claimed_cents) - n(row.scheduled_cents))} less than claimed: check the reasons on their schedule.` : '';
  out(row, () => `  ${row.number} is ${row.status}.${short}`);
}

// ---------------------------------------------------------------- attention and compliance

// True when the welder held a qualification the category accepts, current on the day of the weld.
async function qualifiedCheck() {
  const quals = await db.query(`select staff_id, standard, qualified_on, confirmed_on, expires_on from welder_quals`);
  return (w) => quals.some((q) => q.staff_id === w.welder_id && ACCEPTED_QUALS[w.cc].includes(q.standard)
    && isoDate(q.qualified_on) <= isoDate(w.welded_on) && (!q.expires_on || isoDate(q.expires_on) >= isoDate(w.welded_on))
    && (q.standard !== 'ISO 9606-1' || daysBetween(q.confirmed_on || q.qualified_on, w.welded_on) <= 183));
}

async function complianceRows() {
  const checks = [];
  const add = (id, rule, source, rows, describe) => checks.push({ id, rule, source, count: rows.length, items: rows.map(describe) });

  add('R1', 'Every steel lot used has its mill test certificate', 'AS/NZS 5131:2016 cl 5.2 (test certificates for all steel material, all construction categories)',
    await db.query(`select distinct p.code, a.mark, l.lot_ref, l.heat_no from allocations al join material_lots l on l.id = al.lot_id join assemblies a on a.id = al.assembly_id join projects p on p.id = a.project_id where not l.cert_received and p.status <> 'complete' order by p.code, a.mark`),
    (r) => `${r.code} ${r.mark}: lot ${r.lot_ref} heat ${r.heat_no}, no certificate`);

  add('R2', 'Lot traceability: main members at CC2, every item at CC3 and CC4', 'AS/NZS 5131:2016 cl 4.7.2 and 5.2.3, as amended 2020',
    await db.query(`select v.project_code, v.mark, v.construction_category, v.stage from v_assembly_status v join projects p on p.id = v.project_id
      where p.status <> 'complete' and v.cut_qty > 0 and not exists (select 1 from allocations al where al.assembly_id = v.id)
        and ((v.construction_category = 'CC2' and v.main_member) or v.construction_category in ('CC3','CC4')) order by v.project_code, v.mark`),
    (r) => `${r.project_code} ${r.mark} (${r.construction_category}, ${r.stage}): cut with no heat lot recorded`);

  add('R3', 'Welder and weld procedure traceability at CC3 and CC4', 'AS/NZS 5131:2016 Table 7.4',
    await db.query(`select v.project_code, v.mark, v.construction_category, v.weld_qty from v_assembly_status v
      where v.construction_category in ('CC3','CC4') and v.weld_qty > 0
        and not exists (select 1 from weld_records w where w.assembly_id = v.id and w.wps_id is not null) order by v.project_code, v.mark`),
    (r) => `${r.project_code} ${r.mark}: ${r.weld_qty} welded, no welder and WPS recorded`);

  const welds = await db.query(`select p.code, p.construction_category as cc, a.mark, s.full_name, w.welded_on, w.welder_id from weld_records w join assemblies a on a.id = w.assembly_id join projects p on p.id = a.project_id join staff s on s.id = w.welder_id where p.status <> 'complete' order by w.welded_on desc`);
  const qualifiedOn = await qualifiedCheck();
  add('R4', 'Welds made by a welder qualified to the standard the category calls for, current on the day', 'AS/NZS 5131:2016 Table 7.4 (AS/NZS 1554 at CC1 and CC2; AS/NZS 2980 or ISO 9606-1 at CC3 and CC4); ISO 9606-1:2012 cl 9.2 and 9.3',
    welds.filter((w) => !qualifiedOn(w)), (r) => `${r.code} ${r.mark}: welded ${isoDate(r.welded_on)} by ${r.full_name}, not qualified for ${r.cc} on that day`);
  checks.at(-1).rows = welds.filter((w) => !qualifiedOn(w));

  add('R5', 'ISO 9606-1 qualifications confirmed every six months, none expired', 'ISO 9606-1:2012 cl 9.2 (six-monthly confirmation) and cl 9.3 (revalidation)',
    await db.query(`select full_name, standard, qual_status, confirm_by, expires_on from v_welder_status where active and qual_status in ('expired','confirmation overdue') order by full_name`),
    (r) => `${r.full_name}: ${r.standard} ${r.qual_status}${r.qual_status === 'expired' ? ' ' + isoDate(r.expires_on) : ', was due ' + isoDate(r.confirm_by)}`);

  add('R6', 'SP and FP welds only where the category allows them', 'AS/NZS 5131:2016 Table 7.4 (CC1 is GP only)',
    await db.query(`select project_code, mark, weld_category from v_assembly_status where construction_category = 'CC1' and weld_category in ('SP','FP')`),
    (r) => `${r.project_code} ${r.mark}: ${r.weld_category} welds on a CC1 project`);

  add('R7', 'House rule: no welded mark passes QA or goes to coating without a passed visual weld inspection', 'Your inspection and test plan (docs/compliance.md, rule R7)',
    await db.query(`select v.project_code, v.mark, v.qa_qty, v.coat_qty from v_assembly_status v join projects p on p.id = v.project_id where p.status <> 'complete' and v.weld_category <> 'none' and v.qa_qty > 0
      and not exists (select 1 from inspections i where i.assembly_id = v.id and i.kind = 'visual' and i.result = 'pass') order by v.project_code, v.mark`),
    (r) => `${r.project_code} ${r.mark}: ${r.qa_qty} through QA, ${r.coat_qty} coated, no visual inspection recorded`);

  add('R8', 'House rule: no cutting before a drawing is released for construction, and no shipping a mark cut to a superseded revision', 'Your contract with the builder (docs/compliance.md, rule R8)',
    await holdRows(), (r) => `${r.project} ${r.mark} on ${r.drawing}: ${r.problem}`);

  add('R9', 'A payment schedule arrives within the agreed time, or 20 working days, of each claim', 'Construction Contracts Act 2002 (NZ) ss 20 to 24',
    (await claimRows()).filter((r) => r.schedule_late), (r) => `${r.number} ${r.project} ${money(r.claimed_cents)}: submitted ${isoDate(r.submitted_on)}, ${r.working_days_out} working days, no schedule`);

  return checks;
}

async function compliance() {
  const checks = await complianceRows();
  out(checks, () => [heading('Compliance'), ...checks.map((c) => `\n${c.id}  ${c.count ? 'BREACH ' + c.count : 'clean'}  ${c.rule}\n    Source: ${c.source}${c.items.length ? '\n' + c.items.map((i) => `    - ${i}`).join('\n') : ''}`), '\n  The rules and why each matters: docs/compliance.md. This is a records check, not engineering or legal advice.'].join('\n'));
}

async function attention() {
  const items = [];
  const push = (rank, area, what, action) => items.push({ rank, area, what, action });
  const checks = await complianceRows();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  for (const i of byId.R1.items) push(1, 'traceability', i, 'Chase the supplier for the mill certificate before the mark leaves the yard');
  for (const i of byId.R2.items) push(1, 'traceability', i, 'Find the offcut tag or the cutting list and record the heat: steel allocate');
  for (const i of byId.R3.items) push(1, 'traceability', i, 'Record who welded it and to which WPS: steel weld');
  const byWelder = {};
  for (const w of byId.R4.rows) (byWelder[w.full_name] ||= []).push(`${w.code} ${w.mark} (${w.cc})`);
  for (const [name, list] of Object.entries(byWelder)) push(2, 'welding', `${name} welded ${list.length} mark${list.length > 1 ? 's' : ''} without a qualification current for the category: ${list.join(', ')}`, 'Have the welding coordinator review those welds; raise an NCR for any that cannot be accepted');
  for (const i of byId.R5.items) push(2, 'welding', i, 'Confirm or requalify before their next weld: steel confirm-welder');
  for (const i of byId.R8.items) push(2, 'drawings', i, 'Stop the mark and get the builder or engineer to confirm in writing');
  const openNcrs = await db.query(`select n.number, p.code, a.mark, (current_date - n.raised_on) as age, n.description from ncrs n join projects p on p.id = n.project_id left join assemblies a on a.id = n.assembly_id where n.closed_on is null order by n.raised_on`);
  for (const r of openNcrs) push(3, 'quality', `${r.number} ${r.code} ${r.mark || ''}, ${r.age} days open: ${truncate(r.description, 70)}`, 'Decide the disposition and close it: steel close-ncr');
  for (const i of byId.R7.items) push(3, 'quality', i, 'Record the visual inspection, or pull the mark back');
  const seqs = await sequenceRows();
  for (const s of seqs) {
    const risk = seqRisk(s);
    if (risk === 'LATE') push(4, 'site dates', `${s.project} ${s.sequence} ${s.name} was needed ${isoDate(s.required_on)} (${-s.days_to_go} days ago): ${t3(n(s.tonnes) - n(s.dispatched_t))} t not sent; not ready: ${s.behind || 'all finished, not loaded'}`, 'Call the builder with a new date before their crane crew calls you');
    else if (risk === 'at risk') push(4, 'site dates', `${s.project} ${s.sequence} ${s.name} needed in ${s.days_to_go} days; not ready: ${s.behind}`, 'Put these marks to the front of the floor this week');
  }
  const stuckLoads = await db.query(`select l.number, p.code, l.planned_on, (current_date - l.planned_on) as days, l.notes from loads l join projects p on p.id = l.project_id where l.dispatched_on is null and l.planned_on < current_date order by l.planned_on`);
  for (const l of stuckLoads) push(4, 'dispatch', `${l.number} ${l.code} planned ${isoDate(l.planned_on)}, ${l.days} days, not sent${l.notes ? ': ' + l.notes : ''}`, 'Rebook the truck or record that it left: steel dispatch');
  for (const s of await stalledRows()) push(5, 'floor', `${s.project} ${s.mark} ${s.stage === 'at coating' ? 'out for coating' : 'at ' + s.stage}, nothing moved for ${s.days} days`, s.stage === 'at coating' ? 'Ask the galvaniser or painter for a date' : 'Find out what it is waiting for');
  const waiting = await db.query(`select p.code, d.number, d.title, (current_date - d.issued_on) as days from drawings d join projects p on p.id = d.project_id where d.status = 'for-approval' and p.status = 'active' and d.issued_on <= current_date - 10 order by d.issued_on`);
  for (const d of waiting) push(5, 'drawings', `${d.code} ${d.number} ${d.title} out for approval ${d.days} days`, 'Chase the approval: /draft-chase');
  for (const c of byId.R9.items) push(6, 'money', c, 'The builder owes the claimed amount; draft the follow-up and consider adjudication');
  const proj = await db.query(`select p.*, (select max(period_end) from claims c where c.project_id = p.id) as last_period, (select coalesce(sum(claimed_cents),0) from claims c where c.project_id = p.id) as claimed from projects p where p.status = 'active'`);
  for (const p of proj) {
    const e = await earned(p, today());
    const net = e.earned_cents - Math.round((e.earned_cents * n(p.retention_pct)) / 100) - n(p.claimed);
    if (net > 0 && (!p.last_period || daysBetween(p.last_period, today()) >= 21)) push(6, 'money', `${p.code} ${p.name}: ${money(net)} earned and not claimed${p.last_period ? ', last claim period ended ' + isoDate(p.last_period) : ', never claimed'}`, `Draft the claim: steel claim ${p.code} --save`);
  }
  items.sort((a, b) => a.rank - b.rank);
  out(items, () => heading('Needs attention, worst first') + '\n' + (items.length ? items.map((i, k) => `${String(k + 1).padStart(3)}. [${i.area}] ${i.what}\n       -> ${i.action}`).join('\n') : '  Nothing. The floor, the paperwork and the money are all in order.'));
}

// ---------------------------------------------------------------- import and export

// Tekla PowerFab and Tekla Structures both export an assembly list to Excel. Save it as CSV.
// Columns are matched by name, case-insensitive, with the common variants of each header.
async function importCmd(args, flags) {
  const source = String(args[0] || '').toLowerCase();
  if (!['tekla-powerfab', 'powerfab', 'tekla', 'csv'].includes(source)) throw new CliError('Usage: steel import tekla-powerfab <assembly-list.csv> --project=<code> [--dry-run]');
  const file = args[1];
  if (!file || !existsSync(file)) throw new CliError(`No file at "${file}".`);
  const p = await findProject(flags.project);
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const parsed = [];
  const problems = [];
  rows.forEach((r, i) => {
    const mark = pick(r, 'Assembly Mark', 'Main Mark', 'Mark', 'Piece Mark', 'ASSEMBLY_POS', 'Assembly position');
    const qty = Number(pick(r, 'Quantity', 'Qty', 'No.', 'Number') || 1);
    const kgRaw = pick(r, 'Weight Each (kg)', 'Unit Weight', 'Weight each', 'Weight (kg)', 'Weight', 'ASSEMBLY_WEIGHT');
    const totalKg = pick(r, 'Total Weight (kg)', 'Total Weight');
    const unitKg = kgRaw ? Number(String(kgRaw).replace(/[^0-9.]/g, '')) : totalKg ? Number(String(totalKg).replace(/[^0-9.]/g, '')) / qty : 0;
    if (!mark) return problems.push(`row ${i + 2}: no mark`);
    if (!Number.isInteger(qty) || qty <= 0) return problems.push(`row ${i + 2} ${mark}: quantity "${pick(r, 'Quantity', 'Qty')}" is not a whole number`);
    parsed.push({
      mark, qty, unit_kg: unitKg || 0,
      description: pick(r, 'Description', 'Name', 'Assembly Name') || null,
      profile: pick(r, 'Main Profile', 'Profile', 'Main Member', 'Shape', 'Size') || null,
      grade: pick(r, 'Grade', 'Material') || null,
      sequence: pick(r, 'Sequence', 'Seq', 'Phase', 'Lot') || null,
      drawing: pick(r, 'Drawing', 'Drawing No', 'Drawing Number', 'Sheet') || null,
      revision: pick(r, 'Revision', 'Rev', 'Drawing Rev') || null,
      external_ref: pick(r, 'Assembly ID', 'GUID', 'ID') || null,
    });
  });
  const summary = { project: p.code, rows: rows.length, marks: parsed.length, tonnes: +(parsed.reduce((s, x) => s + x.qty * x.unit_kg, 0) / 1000).toFixed(3), problems, created: 0, updated: 0 };
  if (!flags['dry-run']) {
    await db.exec('BEGIN');
    try {
      for (const x of parsed) {
        let seqId = null;
        if (x.sequence) [{ id: seqId }] = await db.query(`insert into sequences (project_id, code) values ($1,$2) on conflict (project_id, code) do update set code = excluded.code returning id`, [p.id, x.sequence]);
        let dwgId = null;
        if (x.drawing) [{ id: dwgId }] = await db.query(`insert into drawings (project_id, number, revision, status, issued_on) values ($1,$2,coalesce($3,'A'),'for-approval',current_date)
            on conflict (project_id, number) do update set revision = coalesce($3, drawings.revision) returning id`, [p.id, x.drawing, x.revision]);
        const [res] = await db.query(`insert into assemblies (project_id, sequence_id, drawing_id, mark, description, main_profile, grade, qty, unit_kg, external_ref)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            on conflict (project_id, mark) do update set sequence_id = coalesce(excluded.sequence_id, assemblies.sequence_id), drawing_id = coalesce(excluded.drawing_id, assemblies.drawing_id),
              description = coalesce(excluded.description, assemblies.description), main_profile = coalesce(excluded.main_profile, assemblies.main_profile),
              grade = coalesce(excluded.grade, assemblies.grade), qty = excluded.qty, unit_kg = excluded.unit_kg, external_ref = coalesce(excluded.external_ref, assemblies.external_ref)
            returning (xmax = 0) as inserted`, [p.id, seqId, dwgId, x.mark, x.description, x.profile, x.grade, x.qty, x.unit_kg, x.external_ref]);
        if (res.inserted) summary.created++; else summary.updated++;
      }
      await db.exec('COMMIT');
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
  }
  out(summary, () => [
    `  ${flags['dry-run'] ? 'Dry run: would import' : 'Imported'} ${summary.marks} marks, ${t3(summary.tonnes)} t, into ${p.code}.${flags['dry-run'] ? '' : ` ${summary.created} new, ${summary.updated} updated.`}`,
    problems.length ? '  Skipped:\n' + problems.map((x) => `    - ${x}`).join('\n') : '',
    flags['dry-run'] ? '' : '  New drawings come in as for-approval. Release them with: steel drawing <project> <number> --status=for-construction',
  ].filter(Boolean).join('\n'));
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCmd(flags) {
  const dir = path.resolve(REPO_ROOT, str(flags.out) || 'exports');
  mkdirSync(dir, { recursive: true });
  const tables = ['clients', 'staff', 'projects', 'drawings', 'sequences', 'assemblies', 'assembly_progress', 'material_lots', 'allocations',
    'welder_quals', 'wps', 'weld_records', 'inspections', 'ncrs', 'loads', 'load_items', 'claims', 'notes'];
  const counts = {};
  for (const t of tables) {
    const rows = await db.query(`select * from ${t} order by created_at`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    writeFileSync(path.join(dir, `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
    counts[t] = rows.length;
  }
  out({ dir, counts }, () => `  Exported ${tables.length} tables to ${path.relative(REPO_ROOT, dir) || dir}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

async function log(args, flags) {
  const p = await findProject(args[0]);
  const body = args.slice(1).join(' ').trim();
  if (!body) throw new CliError('What happened? steel log <project> "note text"');
  await db.query(`insert into notes (project_id, body, author) values ($1,$2,$3)`, [p.id, body, str(flags.by) || null]);
  out({ project: p.code, body }, () => `  Noted on ${p.code}.`);
}

// ---------------------------------------------------------------- dispatch table

const HELP = `steel: the structural steel fabrication CLI. Add --json to any read for machine output.

  Overview      stats | attention | compliance | floor | tonnes [--weeks=8]
  Projects      projects [--all] | project <p> | log <p> "note"
  Drawings      drawings [--project=p] [--status=s] | holds | drawing <p> <number> [--rev=C] [--status=for-construction]
  Marks         marks [--project=p] [--sequence=S1] [--stage=..] | mark <p> <mark>
                progress <p> <mark> <cut|fit|weld|qa|coat> [--qty=N] [--by=code] [--on=date]
  Sequences     sequences [--project=p] | ready [--project=p]
  Dispatch      loads [--open] | load-new <p> [--planned=date] [--carrier=..] | load-add <load> <mark> [--qty=N] | dispatch <load>
  Material      lots [--no-cert] | receive <lot> --profile=.. [--heat=..] [--cert=..] | allocate <p> <mark> <lot|heat> | trace <p> <mark>
  Welding       welders | weld <p> <mark> --welder=code [--wps=WPS-01] | confirm-welder <code>
  Quality       inspect <p> <mark> --kind=visual|dimensional|mpi|ut|dft|hold-point --result=pass|fail
                ncrs [--open] | ncr <p> [mark] --description=".." | close-ncr <NCR> --disposition=rework|repair|use-as-is|scrap
  Money         claim <p> [--period-end=date] [--save] | claims [--open] | claim-status <claim> --submitted=date|--scheduled=amount|--paid=date
  Data          import tekla-powerfab <file.csv> --project=p [--dry-run] | export [--out=dir]`;

const COMMANDS = {
  stats: () => stats(), projects: (a, f) => projects(f), project: (a) => project(a), drawings: (a, f) => drawings(f), holds: () => holds(),
  drawing: (a, f) => drawing(a, f), marks: (a, f) => marks(f), mark: (a) => mark(a), floor: () => floor(), progress: (a, f) => progress(a, f),
  sequences: (a, f) => sequences(f), ready: (a, f) => ready(f), loads: (a, f) => loads(f), 'load-new': (a, f) => loadNew(a, f),
  'load-add': (a, f) => loadAdd(a, f), dispatch: (a, f) => dispatch(a, f), lots: (a, f) => lots(f), receive: (a, f) => receive(a, f),
  allocate: (a) => allocate(a), trace: (a) => trace(a), welders: () => welders(), weld: (a, f) => weld(a, f),
  'confirm-welder': (a, f) => confirmWelder(a, f), inspect: (a, f) => inspect(a, f), ncrs: (a, f) => ncrs(f), ncr: (a, f) => ncr(a, f),
  'close-ncr': (a, f) => closeNcr(a, f), tonnes: (a, f) => tonnes(f), claim: (a, f) => claim(a, f), claims: (a, f) => claims(f),
  'claim-status': (a, f) => claimStatus(a, f), attention: () => attention(), compliance: () => compliance(),
  import: (a, f) => importCmd(a, f), export: (a, f) => exportCmd(f), log: (a, f) => log(a, f),
};

const { args, flags } = parseArgv(process.argv.slice(2));
JSON_OUT = !!flags.json;
const cmd = args.shift();
if (!cmd || cmd === 'help' || flags.help || !COMMANDS[cmd]) {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && !COMMANDS[cmd] ? 1 : 0);
}
db = await getDb();
try {
  await COMMANDS[cmd](args, flags);
} catch (e) {
  if (e instanceof CliError) { console.error(e.message); process.exitCode = e.code; }
  else { console.error(e.stack || e.message); process.exitCode = 2; }
} finally {
  await db.close();
}
