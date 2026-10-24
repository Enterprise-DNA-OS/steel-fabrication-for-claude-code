#!/usr/bin/env node
// Loads supabase/seed.sql: Kowhai Steel Ltd, a fictional Tauranga structural fabricator with
// four projects, seventeen piece marks at every station, eleven heat lots, four welders, two
// NCRs, four truck loads and three progress claims. Dates are relative to today and every
// insert skips what is already there, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
  const [c] = await db.query(`
    select (select count(*) from projects) as projects, (select count(*) from drawings) as drawings,
           (select count(*) from assemblies) as marks, (select count(*) from material_lots) as lots,
           (select count(*) from welder_quals) as welder_quals, (select count(*) from inspections) as inspections,
           (select count(*) from ncrs) as ncrs, (select count(*) from loads) as loads, (select count(*) from claims) as claims`);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(`seed: ${n.projects} projects, ${n.drawings} drawings, ${n.marks} piece marks, ${n.lots} heat lots, ${n.welder_quals} welder qualifications, ${n.inspections} inspections, ${n.ncrs} NCRs, ${n.loads} loads, ${n.claims} claims`);
  } finally {
    await db.close();
  }
}
