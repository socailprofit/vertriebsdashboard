begin;

-- Durable source revisions. A Close object can be corrected without erasing
-- its earlier observed version; only its current, non-withdrawn version reports.
create table public.close_funnel_events (
 lead_id text not null, event_type text not null, occurred_at timestamptz not null,
 meeting_id text, previous_status text, new_status text, setter_id text, closer_id text,
 source_event_id text not null, source_kind text not null,
 source_updated_at timestamptz not null, source_revision text not null,
 payload jsonb not null, is_current boolean not null default true,
 first_seen_at timestamptz not null, last_seen_at timestamptz not null, withdrawn_at timestamptz,
 primary key(source_kind,source_event_id,source_revision),
 check(source_kind in ('custom_activity','meeting','lead_status_change','opportunity')),
 check(jsonb_typeof(payload)='object'), check(length(source_revision)=64)
);
create unique index close_funnel_current_source on public.close_funnel_events(source_kind,source_event_id) where is_current;
create index close_funnel_lead_time on public.close_funnel_events(lead_id,occurred_at) where is_current and withdrawn_at is null;
create index close_funnel_meeting on public.close_funnel_events(meeting_id) where meeting_id is not null;
create table public.close_funnel_observations (
 observation_id bigint generated always as identity primary key,
 source_kind text not null,source_event_id text not null,source_revision text not null,
 observed_at timestamptz not null,action text not null check(action in ('current','withdrawn')),
 unique(source_kind,source_event_id,source_revision,observed_at,action)
);
-- All process data is private. Aggregated, authorized reporting is the only UI API.
create table public.close_sales_processes (
 process_id text primary key,lead_id text not null,payload jsonb not null,
 last_seen_at timestamptz not null,retired_at timestamptz,
 check(jsonb_typeof(payload)='object'),check(payload->>'process_id'=process_id),check(payload->>'lead_id'=lead_id)
);
create index close_sales_processes_lead on public.close_sales_processes(lead_id) where retired_at is null;
create table public.close_process_meetings (
 meeting_id text primary key,process_id text not null references public.close_sales_processes(process_id),
 payload jsonb not null,last_seen_at timestamptz not null,removed_at timestamptz,
 check(jsonb_typeof(payload)='object'),check(payload->>'meeting_id'=meeting_id),check(payload->>'process_id'=process_id)
);
create index close_process_meetings_process on public.close_process_meetings(process_id) where removed_at is null;
create table public.close_process_events (
 source_kind text not null,source_event_id text not null,event_type text not null,
 process_id text not null references public.close_sales_processes(process_id),
 occurred_at timestamptz not null,payload jsonb not null,
 last_seen_at timestamptz not null,removed_at timestamptz,
 primary key(source_kind,source_event_id,event_type),check(jsonb_typeof(payload)='object')
);
create index close_process_events_process_time on public.close_process_events(process_id,occurred_at) where removed_at is null;
create table public.close_funnel_leads (
 lead_id text primary key,lead_source text,opener_close_user_id text,setter_id text,closer_id text,
 status_id text,source_updated_at timestamptz,last_seen_at timestamptz not null
);

alter table public.close_funnel_events enable row level security;
alter table public.close_funnel_observations enable row level security;
alter table public.close_sales_processes enable row level security;
alter table public.close_process_meetings enable row level security;
alter table public.close_process_events enable row level security;
alter table public.close_funnel_leads enable row level security;
revoke all on public.close_funnel_events,public.close_funnel_observations,public.close_sales_processes,
 public.close_process_meetings,public.close_process_events,public.close_funnel_leads from public,anon,authenticated;
grant all on public.close_funnel_events,public.close_funnel_observations,public.close_sales_processes,
 public.close_process_meetings,public.close_process_events,public.close_funnel_leads to service_role;
grant usage on sequence public.close_funnel_observations_observation_id_seq to service_role;

create function public.reconcile_close_funnel_snapshot(
 p_start_date date,p_end_date date,p_snapshot_started_at timestamptz,
 p_raw jsonb,p_facts jsonb,p_opportunities jsonb,p_leads jsonb,p_bookings jsonb,
 p_meetings jsonb,p_calendar_leads jsonb,p_events jsonb,p_processes jsonb,
 p_meeting_relations jsonb,p_event_relations jsonb,p_funnel_leads jsonb,
 p_status_created_since timestamptz
) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare v_result jsonb; v_rows jsonb;
begin
 -- This transaction is part of the same authoritative full sync, never an
 -- independent lead backfill. Existing lock/staleness checks run first.
 v_result:=public.reconcile_close_calendar_snapshot(p_start_date,p_end_date,p_snapshot_started_at,
  p_raw,p_facts,p_opportunities,p_leads,p_bookings,p_meetings,p_calendar_leads);
 foreach v_rows in array array[p_events,p_processes,p_meeting_relations,p_event_relations,p_funnel_leads] loop
  if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows)>100000
   then raise exception 'Invalid funnel snapshot';end if;
 end loop;
 if p_status_created_since is null or p_status_created_since>p_snapshot_started_at then raise exception 'Invalid status history boundary';end if;
 if exists(select 1 from jsonb_array_elements(p_events) e where nullif(e->>'lead_id','') is null
  or nullif(e->>'source_event_id','') is null or length(e->>'source_revision')<>64
  or jsonb_typeof(e->'payload') is distinct from 'object')
 or exists(select 1 from jsonb_array_elements(p_events) e group by e->>'source_kind',e->>'source_event_id' having count(*)>1)
 then raise exception 'Invalid funnel source revisions';end if;
 if exists(select 1 from jsonb_array_elements(p_processes) p where nullif(p->>'process_id','') is null or nullif(p->>'lead_id','') is null)
 or exists(select 1 from jsonb_array_elements(p_processes) p group by p->>'process_id' having count(*)>1)
 then raise exception 'Invalid process identities';end if;
 if exists(select 1 from jsonb_array_elements(p_meeting_relations) r
  where not exists(select 1 from jsonb_array_elements(p_processes) p where p->>'process_id'=r->>'process_id')
  or not exists(select 1 from jsonb_array_elements(p_meetings) m where m->>'meeting_id'=r->>'meeting_id'))
 or exists(select 1 from jsonb_array_elements(p_event_relations) r
  where not exists(select 1 from jsonb_array_elements(p_processes) p where p->>'process_id'=r->>'process_id'))
 then raise exception 'Incomplete process relationships';end if;

 -- A complete source snapshot may withdraw a deleted object. Status activities
 -- have an explicit creation window; older history must never be withdrawn by
 -- falling out of that window. No unobserved historical status is invented.
 insert into public.close_funnel_observations(source_kind,source_event_id,source_revision,observed_at,action)
 select e.source_kind,e.source_event_id,e.source_revision,p_snapshot_started_at,'withdrawn'
 from public.close_funnel_events e where e.is_current and e.withdrawn_at is null
  and (e.source_kind<>'lead_status_change' or (e.payload->>'date_created')::timestamptz>=p_status_created_since)
  and not exists(select 1 from jsonb_array_elements(p_events) n where n->>'source_kind'=e.source_kind and n->>'source_event_id'=e.source_event_id)
 on conflict do nothing;
 update public.close_funnel_events e set is_current=false,withdrawn_at=p_snapshot_started_at
 where e.is_current and (e.source_kind<>'lead_status_change' or (e.payload->>'date_created')::timestamptz>=p_status_created_since)
  and not exists(select 1 from jsonb_array_elements(p_events) n where n->>'source_kind'=e.source_kind and n->>'source_event_id'=e.source_event_id);
 insert into public.close_funnel_observations(source_kind,source_event_id,source_revision,observed_at,action)
 select n->>'source_kind',n->>'source_event_id',n->>'source_revision',p_snapshot_started_at,'current'
 from jsonb_array_elements(p_events) n where not exists(select 1 from public.close_funnel_events e
  where e.source_kind=n->>'source_kind' and e.source_event_id=n->>'source_event_id' and e.source_revision=n->>'source_revision' and e.is_current)
 on conflict do nothing;
 update public.close_funnel_events e set is_current=false where e.is_current and exists(
  select 1 from jsonb_array_elements(p_events) n where n->>'source_kind'=e.source_kind and n->>'source_event_id'=e.source_event_id and n->>'source_revision'<>e.source_revision);
 insert into public.close_funnel_events(lead_id,event_type,occurred_at,meeting_id,previous_status,new_status,setter_id,closer_id,
  source_event_id,source_kind,source_updated_at,source_revision,payload,is_current,first_seen_at,last_seen_at,withdrawn_at)
 select lead_id,event_type,occurred_at,meeting_id,previous_status,new_status,setter_id,closer_id,
  source_event_id,source_kind,source_updated_at,source_revision,payload,true,p_snapshot_started_at,p_snapshot_started_at,null
 from jsonb_populate_recordset(null::public.close_funnel_events,p_events)
 on conflict(source_kind,source_event_id,source_revision) do update set is_current=true,last_seen_at=excluded.last_seen_at,withdrawn_at=null;

 update public.close_sales_processes s set retired_at=p_snapshot_started_at where s.retired_at is null
  and not exists(select 1 from jsonb_array_elements(p_processes) p where p->>'process_id'=s.process_id);
 insert into public.close_sales_processes(process_id,lead_id,payload,last_seen_at,retired_at)
 select p->>'process_id',p->>'lead_id',p,p_snapshot_started_at,null from jsonb_array_elements(p_processes) p
 on conflict(process_id) do update set lead_id=excluded.lead_id,payload=excluded.payload,last_seen_at=excluded.last_seen_at,retired_at=null;
 update public.close_process_meetings r set removed_at=p_snapshot_started_at where r.removed_at is null
  and not exists(select 1 from jsonb_array_elements(p_meeting_relations) n where n->>'meeting_id'=r.meeting_id);
 insert into public.close_process_meetings(meeting_id,process_id,payload,last_seen_at,removed_at)
 select r->>'meeting_id',r->>'process_id',r,p_snapshot_started_at,null from jsonb_array_elements(p_meeting_relations) r
 on conflict(meeting_id) do update set process_id=excluded.process_id,payload=excluded.payload,last_seen_at=excluded.last_seen_at,removed_at=null;
 update public.close_process_events r set removed_at=p_snapshot_started_at where r.removed_at is null
  and not exists(select 1 from jsonb_array_elements(p_event_relations) n where n->>'source_kind'=r.source_kind
   and n->>'source_event_id'=r.source_event_id and n->>'event_type'=r.event_type);
 insert into public.close_process_events(source_kind,source_event_id,event_type,process_id,occurred_at,payload,last_seen_at,removed_at)
 select r->>'source_kind',r->>'source_event_id',r->>'event_type',r->>'process_id',(r->>'occurred_at')::timestamptz,r,p_snapshot_started_at,null
 from jsonb_array_elements(p_event_relations) r
 on conflict(source_kind,source_event_id,event_type) do update set process_id=excluded.process_id,occurred_at=excluded.occurred_at,
 payload=excluded.payload,last_seen_at=excluded.last_seen_at,removed_at=null;
 insert into public.close_funnel_leads(lead_id,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,last_seen_at)
 select lead_id,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,p_snapshot_started_at
 from jsonb_populate_recordset(null::public.close_funnel_leads,p_funnel_leads)
 on conflict(lead_id) do update set lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id,
 setter_id=excluded.setter_id,closer_id=excluded.closer_id,status_id=excluded.status_id,source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at;
 insert into public.close_lead_reporting(lead_id,lead_source,opener_close_user_id)
 select lead_id,lead_source,opener_close_user_id from public.close_funnel_leads
 on conflict(lead_id) do update set lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id;
 insert into public.close_reconciliation_state values('funnel',p_snapshot_started_at)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 return v_result||jsonb_build_object('funnel_events',jsonb_array_length(p_events),'processes',jsonb_array_length(p_processes));
end;$$;
revoke all on function public.reconcile_close_funnel_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_close_funnel_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) to service_role;
commit;
