import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema extensions;
create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-10-09T09:00:00Z'::timestamptz$$;`);
await db.exec(fs.readFileSync(new URL('fixtures/kpi-schema.sql',import.meta.url),'utf8'));
await db.exec(`alter table daily_sales_metrics add column closer_second_calls integer not null default 0;
create table close_funnel_leads(lead_id text,opener_close_user_id text,report_dimensions jsonb);
create table profiles(user_id uuid,display_name text,role text,sales_person_id uuid,must_change_password boolean default false);
create table sales_targets(sales_person_id uuid,period_start date,period_end date,calls_gross integer,appointment_rate_target numeric,unique(sales_person_id,period_start,period_end));
create table sync_runs(status text,source_window_start timestamptz,source_window_end timestamptz);
insert into sync_runs values('success','2026-07-31T22:00Z','2026-10-10T22:00Z');
create function get_dashboard_metrics(text,date) returns table(slug text,calls_gross integer) language sql as $$
 select p.slug,coalesce(sum(m.calls_gross),0)::integer from public.sales_people p left join public.daily_sales_metrics m on m.sales_person_id=p.id
 and m.metric_date between date_trunc('month',$2)::date and $2 where p.active group by p.slug$$;
insert into sales_people(close_user_id,slug,display_name,color) values
 ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','michael','Michael Giesbrecht','#4f8cff'),
 ('user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','felix','Felix Wenk','#f59e0b');
insert into profiles(user_id,display_name,role,sales_person_id) select '11111111-1111-1111-1111-111111111111','Felix Wenk','sales',id from sales_people where slug='felix';
insert into profiles(user_id,display_name,role) values('22222222-2222-2222-2222-222222222222','Antony Rigone','manager');
insert into daily_sales_metrics(metric_date,sales_person_id,calls_gross,appointments) select '2026-10-08',id,19,2 from sales_people where slug='felix';
insert into close_activity_facts(source_activity_id,source_type,close_user_id,occurred_at,metric_date,metric_hour,appointments,mapping_version)
values ('own-appointment','custom_activity','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR','2026-10-08T10:00Z','2026-10-08',12,1,'test');
insert into close_funnel_leads(lead_id,opener_close_user_id,report_dimensions) values
 ('former','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','{}'),
 ('new','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR','{}');`);
const migration=fs.readFileSync(new URL('../supabase/migrations/20261009090336_replace_active_sales_roster.sql',import.meta.url),'utf8');
const original=(await db.query("select row_to_json(m) v from daily_sales_metrics m")).rows;
for(let i=0;i<2;i++)await db.exec(migration);
assert.deepEqual((await db.query("select slug from sales_people where active order by sort_order,slug")).rows.map(r=>r.slug),['michael','anthony']);
assert.deepEqual((await db.query("select row_to_json(m) v from daily_sales_metrics m join sales_people p on p.id=m.sales_person_id where p.slug='felix'")).rows,original);
assert.equal((await db.query("select appointments from daily_sales_metrics m join sales_people p on p.id=m.sales_person_id where p.slug='anthony'")).rows[0].appointments,1);
await db.exec("set test.viewer='11111111-1111-1111-1111-111111111111'");
assert.equal((await db.query("select has_dashboard_access() ok")).rows[0].ok,false);
await assert.rejects(db.query("select get_opening_monthly_review('2026-10-09')"),/Nicht berechtigt/);
await db.exec("set test.viewer='22222222-2222-2222-2222-222222222222'");
assert.equal((await db.query("select has_dashboard_access() ok")).rows[0].ok,true);
const report=(await db.query("select get_opening_monthly_review('2026-10-09') report")).rows[0].report;
assert.deepEqual([...new Set(report.map(r=>r.slug))].sort(),['anthony','michael']);
assert.equal(report.filter(r=>r.slug==='anthony').every(r=>r.calls_coverage_complete===false),true);
assert.equal(report.filter(r=>r.slug==='michael').every(r=>r.calls_coverage_complete===true),true);
const targets=(await db.query("select * from sales_targets")).rows;
assert.equal(targets.length,1);assert.equal(targets[0].appointment_rate_target,'25');
assert.equal(targets[0].calls_gross,150*60);
assert.deepEqual((await db.query("select get_close_opener_internal('former') former,get_close_opener_internal('new') active")).rows[0],{former:'outside_current_team',active:'anthony'});
assert.equal((await db.query("select get_close_opener_labels_internal() labels")).rows[0].labels.felix,undefined);
console.log('Active roster, own facts, retained history, goals, access, coverage and idempotence verified.');
await db.close();
