-- Steel Fabrication for Claude Code: the schema.
--
-- A structural steel fabricator's week, as plain tables: projects for builders, the drawings
-- and their revisions, erection sequences, the piece marks (assemblies) the detailer's model
-- produced, what each station on the floor has finished, the material lots and their heat
-- numbers, which lot went into which mark, welders and their qualifications, weld procedures,
-- inspections, non-conformances, truck loads and progress claims.
--
-- Runs on any Postgres and on PGlite. No extensions: gen_random_uuid() is built in.

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- people and firms

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  role text not null default 'fabricator',  -- fabricator, welder, supervisor, qa, detailer, office
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- projects

create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  client_id uuid not null references clients(id),
  site text,
  -- AS/NZS 5131 construction category, set by the designer in the specification.
  construction_category text not null default 'CC2' check (construction_category in ('CC1','CC2','CC3','CC4')),
  coating_spec text,
  status text not null default 'active' check (status in ('tender','active','on-hold','complete')),
  contract_value_cents bigint not null default 0,
  contract_tonnes numeric(10,3) not null default 0,
  -- Share of a mark's value earned once it passes QA in the shop; the rest is earned on delivery.
  fabricated_pct numeric(5,2) not null default 80,
  retention_pct numeric(5,2) not null default 0,
  payment_days integer not null default 20,
  started_on date,
  due_on date,
  external_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table drawings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number text not null,
  title text,
  revision text not null default 'A',
  status text not null default 'for-approval'
    check (status in ('for-approval','approved','for-construction','on-hold','superseded')),
  issued_on date,
  approved_on date,
  approver text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);

create table sequences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text not null,
  name text,
  required_on date,          -- when the erector needs it on site
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table assemblies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  sequence_id uuid references sequences(id) on delete set null,
  drawing_id uuid references drawings(id) on delete set null,
  mark text not null,
  description text,
  main_profile text,
  grade text,
  qty integer not null default 1 check (qty > 0),
  unit_kg numeric(10,2) not null default 0,
  weld_category text not null default 'GP' check (weld_category in ('none','GP','SP','FP')),
  coating text not null default 'paint' check (coating in ('none','paint','galv','galv+paint')),
  main_member boolean not null default true,
  fabricated_rev text,       -- the drawing revision on the floor when cutting started
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, mark)
);

-- ---------------------------------------------------------------- the floor

create table stations (
  code text primary key,
  name text not null,
  ord integer not null unique
);

insert into stations (code, name, ord) values
  ('cut', 'Saw and plasma', 10),
  ('fit', 'Fit-up', 20),
  ('weld', 'Welding', 30),
  ('qa', 'QA check', 40),
  ('coat', 'Coating back', 50);

create table assembly_progress (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references assemblies(id) on delete cascade,
  station text not null references stations(code),
  qty integer not null check (qty > 0),
  done_on date not null default current_date,
  staff_id uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assembly_id, station, done_on)
);

-- ---------------------------------------------------------------- material and traceability

create table material_lots (
  id uuid primary key default gen_random_uuid(),
  lot_ref text not null unique,
  heat_no text,
  profile text not null,
  grade text,
  supplier text,
  cert_ref text,             -- the mill test certificate number or file name
  cert_received boolean not null default false,
  received_on date,
  length_m numeric(8,3),
  qty integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table allocations (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references assemblies(id) on delete cascade,
  lot_id uuid not null references material_lots(id),
  allocated_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assembly_id, lot_id)
);

-- ---------------------------------------------------------------- welding

create table welder_quals (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  standard text not null check (standard in ('AS/NZS 1554','AS/NZS 2980','ISO 9606-1')),
  process text not null,     -- 135 MAG, 136 FCAW, 111 MMA
  position text,
  qualified_on date not null,
  confirmed_on date,         -- last six-monthly confirmation (ISO 9606-1 clause 9.2)
  expires_on date,
  cert_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, standard, process)
);

create table wps (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  process text not null,
  description text,
  approved_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table weld_records (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references assemblies(id) on delete cascade,
  welder_id uuid not null references staff(id),
  wps_id uuid references wps(id),
  welded_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assembly_id, welder_id, welded_on)
);

-- ---------------------------------------------------------------- quality

create table inspections (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references assemblies(id) on delete cascade,
  kind text not null check (kind in ('visual','dimensional','mpi','ut','dft','hold-point')),
  result text not null default 'pass' check (result in ('pass','fail','pending')),
  inspected_on date not null default current_date,
  inspector text,
  reading text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assembly_id, kind, inspected_on)
);

create table ncrs (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  assembly_id uuid references assemblies(id) on delete set null,
  raised_on date not null default current_date,
  description text not null,
  disposition text check (disposition in ('rework','repair','use-as-is','scrap')),
  closed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- dispatch and money

create table loads (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  carrier text,
  planned_on date,
  dispatched_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table load_items (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads(id) on delete cascade,
  assembly_id uuid not null references assemblies(id),
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (load_id, assembly_id)
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  period_end date not null,
  earned_cents bigint not null default 0,      -- value earned to date at period end
  previous_cents bigint not null default 0,    -- claimed before this claim
  retention_cents bigint not null default 0,
  claimed_cents bigint not null default 0,     -- this claim, after retention
  status text not null default 'draft' check (status in ('draft','submitted','scheduled','paid')),
  submitted_on date,
  scheduled_cents bigint,
  scheduled_on date,
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  body text not null,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['clients','staff','projects','drawings','sequences','assemblies','assembly_progress',
    'material_lots','allocations','welder_quals','wps','weld_records','inspections','ncrs','loads','load_items','claims','notes']
  loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- views

-- One row per piece mark: where it is on the floor, what has shipped, what is ready.
create view v_assembly_status as
with done as (
  select assembly_id,
         sum(qty) filter (where station = 'cut')  as cut,
         sum(qty) filter (where station = 'fit')  as fit,
         sum(qty) filter (where station = 'weld') as weld,
         sum(qty) filter (where station = 'qa')   as qa,
         sum(qty) filter (where station = 'coat') as coat,
         max(done_on) as last_move
  from assembly_progress group by assembly_id
), shipped as (
  select li.assembly_id,
         sum(li.qty) as loaded,
         sum(li.qty) filter (where l.dispatched_on is not null) as dispatched
  from load_items li join loads l on l.id = li.load_id group by li.assembly_id
), s as (
  select a.*, p.code as project_code, p.construction_category, sq.code as sequence_code, sq.required_on,
         d.number as drawing_no, d.revision as drawing_rev, d.status as drawing_status,
         least(coalesce(dn.cut,0), a.qty)  as cut_qty,
         least(coalesce(dn.fit,0), a.qty)  as fit_qty,
         least(coalesce(dn.weld,0), a.qty) as weld_qty,
         least(coalesce(dn.qa,0), a.qty)   as qa_qty,
         least(coalesce(dn.coat,0), a.qty) as coat_qty,
         coalesce(sh.loaded,0) as loaded_qty,
         coalesce(sh.dispatched,0) as dispatched_qty,
         dn.last_move
  from assemblies a
  join projects p on p.id = a.project_id
  left join sequences sq on sq.id = a.sequence_id
  left join drawings d on d.id = a.drawing_id
  left join done dn on dn.assembly_id = a.id
  left join shipped sh on sh.assembly_id = a.id
)
select s.*,
       round(s.qty * s.unit_kg / 1000.0, 3) as tonnes,
       (case when s.coating = 'none' then s.qa_qty else s.coat_qty end) as finished_qty,
       greatest((case when s.coating = 'none' then s.qa_qty else s.coat_qty end) - s.loaded_qty, 0) as ready_qty,
       case
         when s.dispatched_qty >= s.qty then 'dispatched'
         when (case when s.coating = 'none' then s.qa_qty else s.coat_qty end) >= s.qty then 'ready'
         when s.qa_qty >= s.qty then 'at coating'
         when s.weld_qty >= s.qty then 'awaiting QA'
         when s.fit_qty >= s.qty then 'welding'
         when s.cut_qty >= s.qty then 'fit-up'
         when s.cut_qty > 0 then 'cutting'
         else 'not started'
       end as stage
from s;

-- One row per project: tonnes through each gate and the value earned.
create view v_project_tonnes as
select p.id as project_id, p.code, p.name, c.name as client, p.status, p.construction_category,
       p.contract_value_cents, p.contract_tonnes, p.fabricated_pct, p.retention_pct, p.due_on,
       count(v.id) as marks,
       coalesce(sum(v.qty * v.unit_kg),0) / 1000.0 as model_tonnes,
       coalesce(sum(v.cut_qty * v.unit_kg),0) / 1000.0 as cut_tonnes,
       coalesce(sum(v.qa_qty * v.unit_kg),0) / 1000.0 as qa_tonnes,
       coalesce(sum(v.dispatched_qty * v.unit_kg),0) / 1000.0 as dispatched_tonnes
from projects p
join clients c on c.id = p.client_id
left join v_assembly_status v on v.project_id = p.id
group by p.id, c.name;

-- Welder qualifications and where each one stands today.
create view v_welder_status as
select q.*, s.code as staff_code, s.full_name, s.active,
       case
         when q.expires_on is not null and q.expires_on < current_date then 'expired'
         when q.standard = 'ISO 9606-1' and coalesce(q.confirmed_on, q.qualified_on) + interval '6 months' < current_date then 'confirmation overdue'
         when q.expires_on is not null and q.expires_on < current_date + 30 then 'expires soon'
         else 'current'
       end as qual_status,
       (coalesce(q.confirmed_on, q.qualified_on) + interval '6 months')::date as confirm_by
from welder_quals q join staff s on s.id = q.staff_id;
