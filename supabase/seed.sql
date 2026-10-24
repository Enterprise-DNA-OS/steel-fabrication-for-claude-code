-- Demo data: Kowhai Steel Ltd, a fictional 22-person structural fabricator in Tauranga.
-- Four projects for three builders, drawings at every status, erection sequences with one
-- already late, piece marks at every station, heat lots with one missing certificate, four
-- welders (one expired, one overdue for confirmation), a failed UT test, a stuck truck load
-- and a payment claim with no payment schedule. Every date is relative to today, so the
-- attention list always has something to say. Idempotent: every insert skips what exists.

insert into clients (name, contact_name, email, phone) values
  ('Harbourline Construction', 'Dean Morrow', 'dean@harbourline.example', '07 555 0141'),
  ('Coldline Builders', 'Mere Tapsell', 'mere@coldline.example', '07 555 0188'),
  ('Orchard Build Ltd', 'Gareth Lim', 'gareth@orchardbuild.example', '07 555 0102')
on conflict (name) do nothing;

insert into staff (code, full_name, role) values
  ('W-AR', 'Aroha Reti', 'welder'),
  ('W-MK', 'Mike Kuru', 'welder'),
  ('W-TH', 'Tom Hale', 'welder'),
  ('W-SL', 'Sione Lata', 'welder'),
  ('S-JB', 'Jo Brown', 'qa'),
  ('S-DW', 'Dave Wilson', 'fabricator'),
  ('S-PN', 'Priya Nair', 'detailer')
on conflict (code) do nothing;

insert into projects (code, name, client_id, site, construction_category, coating_spec, status,
  contract_value_cents, contract_tonnes, fabricated_pct, retention_pct, payment_days, started_on, due_on, external_ref)
select v.code, v.name, c.id, v.site, v.cc, v.coating, v.status, v.value, v.tonnes, 80, v.ret, 20,
       current_date + v.start_off, current_date + v.due_off, v.ext
from (values
  ('P-210', 'Bayfair Medical Centre', 'Harbourline Construction', 'Girven Road, Mount Maunganui', 'CC2', 'Zinc primer and two-coat epoxy, 240 um', 'active', 48600000::bigint, 62.0::numeric, 5.0::numeric, -70, 40, 'HB-2291'),
  ('P-214', 'Mount Cold Store extension', 'Coldline Builders', 'Totara Street, Mount Maunganui', 'CC3', 'Hot-dip galvanised to AS/NZS 4680', 'active', 31200000, 38.0, 5.0, -40, 55, 'CB-0417'),
  ('P-218', 'Te Puke packhouse canopy', 'Orchard Build Ltd', 'No 1 Road, Te Puke', 'CC2', 'Hot-dip galvanised', 'active', 9800000, 14.0, 0.0, -25, 30, 'OB-118'),
  ('P-205', 'Papamoa retail block', 'Harbourline Construction', 'Domain Road, Papamoa', 'CC2', 'Zinc primer and topcoat', 'complete', 9600000, 3.0, 5.0, -150, -45, 'HB-2240')
) as v(code, name, client, site, cc, coating, status, value, tonnes, ret, start_off, due_off, ext)
join clients c on c.name = v.client
on conflict (code) do nothing;

insert into drawings (project_id, number, title, revision, status, issued_on, approved_on, approver)
select p.id, v.number, v.title, v.rev, v.status, current_date + v.issued_off,
       case when v.appr_off is null then null else current_date + v.appr_off end, v.approver
from (values
  ('P-210', 'D-101', 'Ground floor columns', 'B', 'for-construction', -60, -52, 'Dean Morrow'),
  ('P-210', 'D-102', 'Level 1 beams grid A to D', 'A', 'for-construction', -58, -50, 'Dean Morrow'),
  ('P-210', 'D-103', 'Level 1 beams grid E to H', 'C', 'for-construction', -9, -6, 'Dean Morrow'),
  ('P-210', 'D-104', 'Roof rafters', 'A', 'for-construction', -45, -38, 'Dean Morrow'),
  ('P-210', 'D-105', 'Plant deck and transfer beam', 'A', 'for-approval', -16, null, null),
  ('P-214', 'D-201', 'Cold store columns', 'A', 'for-construction', -35, -30, 'Mere Tapsell'),
  ('P-214', 'D-202', 'Portal rafters', 'B', 'on-hold', -28, null, null),
  ('P-214', 'D-203', 'Loading dock canopy', 'A', 'approved', -12, -4, 'Mere Tapsell'),
  ('P-218', 'D-301', 'Canopy frames', 'A', 'for-construction', -22, -19, 'Gareth Lim'),
  ('P-205', 'D-001', 'Shopfront portal frames', 'A', 'for-construction', -140, -132, 'Dean Morrow')
) as v(project, number, title, rev, status, issued_off, appr_off, approver)
join projects p on p.code = v.project
on conflict (project_id, number) do nothing;

insert into sequences (project_id, code, name, required_on)
select p.id, v.code, v.name, current_date + v.req_off
from (values
  ('P-210', 'S1', 'Ground floor frame', -3),
  ('P-210', 'S2', 'Level 1 and roof', 5),
  ('P-210', 'S3', 'Plant deck', 21),
  ('P-214', 'S1', 'Cold store frame', 10),
  ('P-214', 'S2', 'Loading dock', 30),
  ('P-218', 'S1', 'Canopy', 14),
  ('P-205', 'S1', 'Portal frames', -48)
) as v(project, code, name, req_off)
join projects p on p.code = v.project
on conflict (project_id, code) do nothing;

insert into assemblies (project_id, sequence_id, drawing_id, mark, description, main_profile, grade, qty, unit_kg,
  weld_category, coating, main_member, fabricated_rev)
select p.id, sq.id, d.id, v.mark, v.descr, v.profile, v.grade, v.qty, v.kg, v.wcat, v.coating, v.main, v.frev
from (values
  ('P-210', 'S1', 'D-101', 'C1', 'Column grid A, base plate and cap', '310UC137', '300PLUS', 6, 412.0::numeric, 'SP', 'paint', true, 'B'),
  ('P-210', 'S1', 'D-101', 'C2', 'Column grid D, with brackets', '310UC118', '300PLUS', 4, 380.0, 'SP', 'paint', true, 'B'),
  ('P-210', 'S1', 'D-102', 'B1', 'Level 1 beam grid A to D', '460UB67', '300PLUS', 8, 265.0, 'GP', 'paint', true, 'A'),
  ('P-210', 'S1', 'D-101', 'BR1', 'Cross bracing rod set', 'M20 rod', '250', 12, 38.0, 'GP', 'paint', false, 'B'),
  ('P-210', 'S2', 'D-103', 'B2', 'Level 1 beam grid E to H', '460UB74', '300PLUS', 6, 298.0, 'GP', 'paint', true, 'B'),
  ('P-210', 'S2', 'D-104', 'R1', 'Roof rafter', '530UB82', '300PLUS', 6, 540.0, 'GP', 'paint', true, 'A'),
  ('P-210', 'S2', 'D-104', 'CL1', 'Purlin cleat', '10 mm plate', '250', 40, 6.0, 'GP', 'paint', false, 'A'),
  ('P-210', 'S3', 'D-105', 'B3', 'Plant deck beam', '360UB45', '300PLUS', 4, 210.0, 'GP', 'paint', true, null),
  ('P-210', 'S3', 'D-105', 'B4', 'Transfer beam', '700WB115', '300PLUS', 2, 1150.0, 'SP', 'paint', true, 'A'),
  ('P-214', 'S1', 'D-201', 'K1', 'Cold store column', '310UC97', '300PLUS', 4, 520.0, 'SP', 'galv', true, 'A'),
  ('P-214', 'S1', 'D-201', 'K2', 'Eaves beam', '410UB54', '300PLUS', 6, 330.0, 'SP', 'galv', true, 'A'),
  ('P-214', 'S1', 'D-202', 'K3', 'Portal rafter', '610UB101', '300PLUS', 2, 860.0, 'SP', 'galv', true, 'A'),
  ('P-214', 'S1', 'D-201', 'CL2', 'Girt cleat', '8 mm plate', '250', 60, 4.0, 'GP', 'galv', false, 'A'),
  ('P-214', 'S2', 'D-203', 'K5', 'Dock canopy beam', '250UB31', '300PLUS', 4, 410.0, 'GP', 'galv', true, null),
  ('P-218', 'S1', 'D-301', 'G1', 'Canopy column', '150UC23', '300PLUS', 8, 145.0, 'GP', 'galv', true, 'A'),
  ('P-218', 'S1', 'D-301', 'G2', 'Canopy rafter', '200UB25', '300PLUS', 8, 210.0, 'GP', 'galv', true, 'A'),
  ('P-205', 'S1', 'D-001', 'PF1', 'Portal frame', '360UB50', '300PLUS', 10, 300.0, 'GP', 'paint', true, 'A')
) as v(project, seq, dwg, mark, descr, profile, grade, qty, kg, wcat, coating, main, frev)
join projects p on p.code = v.project
left join sequences sq on sq.project_id = p.id and sq.code = v.seq
left join drawings d on d.project_id = p.id and d.number = v.dwg
on conflict (project_id, mark) do nothing;

insert into assembly_progress (assembly_id, station, qty, done_on, staff_id)
select a.id, v.station, v.qty, current_date + v.off, s.id
from (values
  ('P-210', 'C1', 'cut', 6, -30, 'S-DW'), ('P-210', 'C1', 'fit', 6, -26, 'S-DW'), ('P-210', 'C1', 'weld', 6, -22, 'W-AR'),
  ('P-210', 'C1', 'qa', 6, -20, 'S-JB'), ('P-210', 'C1', 'coat', 6, -12, 'S-JB'),
  ('P-210', 'C2', 'cut', 4, -28, 'S-DW'), ('P-210', 'C2', 'fit', 4, -24, 'S-DW'), ('P-210', 'C2', 'weld', 4, -19, 'W-MK'),
  ('P-210', 'C2', 'qa', 4, -17, 'S-JB'), ('P-210', 'C2', 'coat', 4, -8, 'S-JB'),
  ('P-210', 'B1', 'cut', 8, -21, 'S-DW'), ('P-210', 'B1', 'fit', 8, -16, 'S-DW'), ('P-210', 'B1', 'weld', 8, -11, 'W-TH'),
  ('P-210', 'B1', 'qa', 8, -9, 'S-JB'), ('P-210', 'B1', 'coat', 5, -4, 'S-JB'),
  ('P-210', 'BR1', 'cut', 12, -25, 'S-DW'), ('P-210', 'BR1', 'fit', 12, -23, 'S-DW'), ('P-210', 'BR1', 'weld', 12, -22, 'W-TH'),
  ('P-210', 'BR1', 'qa', 12, -21, 'S-JB'), ('P-210', 'BR1', 'coat', 12, -14, 'S-JB'),
  ('P-210', 'B2', 'cut', 6, -12, 'S-DW'), ('P-210', 'B2', 'fit', 6, -7, 'S-DW'), ('P-210', 'B2', 'weld', 2, -3, 'W-SL'),
  ('P-210', 'R1', 'cut', 6, -6, 'S-DW'),
  ('P-210', 'CL1', 'cut', 40, -15, 'S-DW'), ('P-210', 'CL1', 'fit', 40, -13, 'S-DW'), ('P-210', 'CL1', 'weld', 40, -12, 'W-TH'),
  ('P-210', 'CL1', 'qa', 40, -11, 'S-JB'), ('P-210', 'CL1', 'coat', 40, -5, 'S-JB'),
  ('P-210', 'B4', 'cut', 2, -2, 'S-DW'),
  ('P-214', 'K1', 'cut', 4, -18, 'S-DW'), ('P-214', 'K1', 'fit', 4, -14, 'S-DW'), ('P-214', 'K1', 'weld', 4, -6, 'W-AR'),
  ('P-214', 'K1', 'qa', 4, -4, 'S-JB'),
  ('P-214', 'K2', 'cut', 6, -16, 'S-DW'), ('P-214', 'K2', 'fit', 6, -12, 'S-DW'), ('P-214', 'K2', 'weld', 6, -8, 'W-TH'),
  ('P-214', 'K2', 'qa', 3, -5, 'S-JB'),
  ('P-214', 'K3', 'cut', 2, -10, 'S-DW'), ('P-214', 'K3', 'fit', 2, -7, 'S-DW'),
  ('P-214', 'CL2', 'cut', 60, -9, 'S-DW'),
  ('P-218', 'G1', 'cut', 8, -20, 'S-DW'), ('P-218', 'G1', 'fit', 8, -17, 'S-DW'), ('P-218', 'G1', 'weld', 8, -14, 'W-MK'),
  ('P-218', 'G1', 'qa', 8, -13, 'S-JB'),
  ('P-218', 'G2', 'cut', 8, -18, 'S-DW'), ('P-218', 'G2', 'fit', 4, -12, 'S-DW'),
  ('P-205', 'PF1', 'cut', 10, -80, 'S-DW'), ('P-205', 'PF1', 'fit', 10, -75, 'S-DW'), ('P-205', 'PF1', 'weld', 10, -70, 'W-TH'),
  ('P-205', 'PF1', 'qa', 10, -68, 'S-JB'), ('P-205', 'PF1', 'coat', 10, -60, 'S-JB')
) as v(project, mark, station, qty, off, staff)
join projects p on p.code = v.project
join assemblies a on a.project_id = p.id and a.mark = v.mark
left join staff s on s.code = v.staff
on conflict (assembly_id, station, done_on) do nothing;

insert into material_lots (lot_ref, heat_no, profile, grade, supplier, cert_ref, cert_received, received_on, length_m, qty)
select v.lot, v.heat, v.profile, v.grade, v.supplier, v.cert, v.has_cert, current_date + v.off, v.len, v.qty
from (values
  ('L-24117', '24117', '310UC137', '300PLUS', 'Steel and Tube', 'MTC-24117.pdf', true, -40, 12.0::numeric, 6),
  ('L-24203', '24203', '310UC118', '300PLUS', 'Steel and Tube', null, false, -30, 12.0, 4),
  ('L-23988', '23988', '460UB67', '300PLUS', 'Fletcher Steel', 'MTC-23988.pdf', true, -35, 15.0, 8),
  ('L-24310', '24310', '530UB82', '300PLUS', 'Fletcher Steel', 'MTC-24310.pdf', true, -14, 15.0, 6),
  ('L-24611', '24611', '700WB115', '300PLUS', 'Steel and Tube', 'MTC-24611.pdf', true, -5, 12.0, 2),
  ('L-24500', '24500', '310UC97', '300PLUS', 'Steel and Tube', 'MTC-24500.pdf', true, -24, 12.0, 4),
  ('L-24502', '24502', '410UB54', '300PLUS', 'Steel and Tube', 'MTC-24502.pdf', true, -24, 12.0, 6),
  ('L-24401', '24401', '150UC23', '300PLUS', 'Fletcher Steel', 'MTC-24401.pdf', true, -26, 9.0, 8),
  ('L-24402', '24402', '200UB25', '300PLUS', 'Fletcher Steel', 'MTC-24402.pdf', true, -26, 9.0, 8),
  ('L-24620', '24620', '200PFC', '300PLUS', 'Steel and Tube', null, false, -3, 12.0, 10),
  ('L-23710', '23710', '360UB50', '300PLUS', 'Fletcher Steel', 'MTC-23710.pdf', true, -90, 12.0, 10)
) as v(lot, heat, profile, grade, supplier, cert, has_cert, off, len, qty)
on conflict (lot_ref) do nothing;

insert into allocations (assembly_id, lot_id, allocated_on)
select a.id, l.id, current_date + v.off
from (values
  ('P-210', 'C1', 'L-24117', -30),
  ('P-210', 'C2', 'L-24203', -28),
  ('P-210', 'B1', 'L-23988', -21),
  ('P-210', 'R1', 'L-24310', -6),
  ('P-214', 'K1', 'L-24500', -18),
  ('P-214', 'K2', 'L-24502', -16),
  ('P-218', 'G1', 'L-24401', -20),
  ('P-218', 'G2', 'L-24402', -18),
  ('P-205', 'PF1', 'L-23710', -80)
) as v(project, mark, lot, off)
join projects p on p.code = v.project
join assemblies a on a.project_id = p.id and a.mark = v.mark
join material_lots l on l.lot_ref = v.lot
on conflict (assembly_id, lot_id) do nothing;

insert into welder_quals (staff_id, standard, process, position, qualified_on, confirmed_on, expires_on, cert_ref)
select s.id, v.std, v.process, v.pos, current_date + v.q_off,
       case when v.c_off is null then null else current_date + v.c_off end,
       case when v.e_off is null then null else current_date + v.e_off end, v.cert
from (values
  ('W-AR', 'ISO 9606-1', '135 MAG', 'PF', -400, -60, 695, 'WQ-0331'),
  ('W-MK', 'ISO 9606-1', '136 FCAW', 'PB', -500, -250, 595, 'WQ-0290'),
  ('W-TH', 'AS/NZS 1554', '135 MAG', 'PF', -900, null, null, 'WQ-0187'),
  ('W-SL', 'AS/NZS 2980', '135 MAG', 'PG', -1100, null, -20, 'WQ-0142')
) as v(staff, std, process, pos, q_off, c_off, e_off, cert)
join staff s on s.code = v.staff
on conflict (staff_id, standard, process) do nothing;

insert into wps (code, process, description, approved_on) values
  ('WPS-01', '135 MAG', 'Fillet and butt welds, 300PLUS to 300PLUS, SP category', current_date - 700),
  ('WPS-02', '136 FCAW', 'Complete penetration butt welds, column splices', current_date - 650),
  ('WPS-03', '135 MAG', 'General purpose fillet welds, cleats and brackets', current_date - 700)
on conflict (code) do nothing;

insert into weld_records (assembly_id, welder_id, wps_id, welded_on)
select a.id, s.id, w.id, current_date + v.off
from (values
  ('P-210', 'C1', 'W-AR', 'WPS-01', -22),
  ('P-210', 'C2', 'W-MK', 'WPS-02', -19),
  ('P-210', 'B1', 'W-TH', 'WPS-03', -11),
  ('P-210', 'B2', 'W-SL', 'WPS-03', -3),
  ('P-214', 'K1', 'W-AR', 'WPS-01', -6),
  ('P-214', 'K1', 'W-MK', 'WPS-02', -7),
  ('P-214', 'K2', 'W-TH', 'WPS-01', -8),
  ('P-218', 'G1', 'W-MK', 'WPS-03', -14),
  ('P-205', 'PF1', 'W-TH', 'WPS-03', -70)
) as v(project, mark, welder, wps, off)
join projects p on p.code = v.project
join assemblies a on a.project_id = p.id and a.mark = v.mark
join staff s on s.code = v.welder
join wps w on w.code = v.wps
on conflict (assembly_id, welder_id, welded_on) do nothing;

insert into inspections (assembly_id, kind, result, inspected_on, inspector, reading, notes)
select a.id, v.kind, v.result, current_date + v.off, v.inspector, v.reading, v.notes
from (values
  ('P-210', 'C1', 'visual', 'pass', -20, 'Jo Brown', null, null),
  ('P-210', 'C1', 'dft', 'pass', -12, 'Jo Brown', '248 um average', null),
  ('P-210', 'C2', 'visual', 'pass', -17, 'Jo Brown', null, null),
  ('P-210', 'B1', 'visual', 'pass', -9, 'Jo Brown', null, null),
  ('P-210', 'BR1', 'visual', 'pass', -21, 'Jo Brown', null, null),
  ('P-214', 'K1', 'visual', 'pass', -4, 'Jo Brown', null, null),
  ('P-214', 'K2', 'visual', 'pass', -5, 'Jo Brown', null, null),
  ('P-214', 'K2', 'ut', 'fail', -5, 'Bay NDT Services', 'Lack of fusion, 40 mm, splice weld on K2/4', 'Third-party UT on SP butt welds'),
  ('P-218', 'G1', 'visual', 'pass', -13, 'Jo Brown', null, null),
  ('P-205', 'PF1', 'visual', 'pass', -68, 'Jo Brown', null, null)
) as v(project, mark, kind, result, off, inspector, reading, notes)
join projects p on p.code = v.project
join assemblies a on a.project_id = p.id and a.mark = v.mark
on conflict (assembly_id, kind, inspected_on) do nothing;

insert into ncrs (number, project_id, assembly_id, raised_on, description, disposition, closed_on)
select v.number, p.id, a.id, current_date + v.off, v.descr, v.disp,
       case when v.c_off is null then null else current_date + v.c_off end
from (values
  ('NCR-031', 'P-214', 'K2', -5, 'UT found lack of fusion on the splice weld of K2 piece 4. Piece held at QA.', null, null),
  ('NCR-029', 'P-210', 'C1', -24, 'Base plate holes drilled 3 mm off grid on one column. Re-drilled and checked.', 'rework', -21)
) as v(number, project, mark, off, descr, disp, c_off)
join projects p on p.code = v.project
left join assemblies a on a.project_id = p.id and a.mark = v.mark
on conflict (number) do nothing;

insert into loads (number, project_id, carrier, planned_on, dispatched_on, notes)
select v.number, p.id, v.carrier, current_date + v.plan_off,
       case when v.disp_off is null then null else current_date + v.disp_off end, v.notes
from (values
  ('L-0990', 'P-205', 'Bay Haulage', -48, -48, 'Final load'),
  ('L-1001', 'P-210', 'Bay Haulage', -6, -6, 'Sequence 1, first load'),
  ('L-1003', 'P-210', 'Bay Haulage', -2, null, 'Truck not confirmed by the builder''s crane crew'),
  ('L-1002', 'P-210', 'Bay Haulage', 1, null, null)
) as v(number, project, carrier, plan_off, disp_off, notes)
join projects p on p.code = v.project
on conflict (number) do nothing;

insert into load_items (load_id, assembly_id, qty)
select l.id, a.id, v.qty
from (values
  ('L-0990', 'PF1', 10),
  ('L-1001', 'C1', 4),
  ('L-1001', 'BR1', 12),
  ('L-1003', 'B1', 5),
  ('L-1002', 'C2', 4),
  ('L-1002', 'C1', 2)
) as v(load, mark, qty)
join loads l on l.number = v.load
join assemblies a on a.project_id = l.project_id and a.mark = v.mark
on conflict (load_id, assembly_id) do nothing;

insert into claims (number, project_id, period_end, earned_cents, previous_cents, retention_cents, claimed_cents,
  status, submitted_on, scheduled_cents, scheduled_on, paid_on)
select v.number, p.id, current_date + v.period_off, v.earned, v.prev, v.ret, v.claimed, v.status,
       case when v.sub_off is null then null else current_date + v.sub_off end,
       v.sched,
       case when v.sch_off is null then null else current_date + v.sch_off end,
       case when v.paid_off is null then null else current_date + v.paid_off end
from (values
  ('PC-205-04', 'P-205', -35, 9600000::bigint, 7680000::bigint, 480000::bigint, 1440000::bigint, 'submitted', -32, null::bigint, null::int, null::int),
  ('PC-210-01', 'P-210', -55, 3920000, 0, 196000, 3724000, 'paid', -52, 3724000, -40, -20),
  ('PC-210-02', 'P-210', -24, 12250000, 3724000, 612500, 7913500, 'submitted', -22, null, null, null)
) as v(number, project, period_off, earned, prev, ret, claimed, status, sub_off, sched, sch_off, paid_off)
join projects p on p.code = v.project
on conflict (number) do nothing;

insert into notes (project_id, body, author, created_at)
select p.id, v.body, v.author, now() + make_interval(days => v.off)
from (values
  ('P-210', 'Dean says the crane is booked for sequence 2 on the Monday. Plant deck drawings still with the engineer.', 'Priya Nair', -4),
  ('P-214', 'Galvaniser quoting 7 working days turnaround on K1 and K2.', 'Jo Brown', -3)
) as v(project, body, author, off)
join projects p on p.code = v.project
where not exists (select 1 from notes n where n.body = v.body);
