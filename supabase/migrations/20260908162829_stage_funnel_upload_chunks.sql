begin;

-- Upload preparation is never a reporting source. Only the final transaction
-- invokes the existing, validated reconciliation; no applied function changes.
create table public.close_funnel_uploads (
 run_id uuid primary key,
 snapshot_started_at timestamptz not null,
 manifest jsonb not null,
 state text not null default 'uploading' check(state in ('uploading','committed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 committed_at timestamptz,
 result jsonb,
 check((state='committed')=(committed_at is not null))
);
create index close_funnel_upload_expiry on public.close_funnel_uploads(expires_at);
create table public.close_funnel_upload_chunks (
 run_id uuid not null references public.close_funnel_uploads(run_id) on delete cascade,
 section text not null,
 chunk_index integer not null check(chunk_index>=0),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 payload_bytes integer not null check(payload_bytes between 1 and 262144),
 row_count integer not null check(row_count>=0),
 payload_text text not null,
 primary key(run_id,section,chunk_index)
);
alter table public.close_funnel_uploads enable row level security;
alter table public.close_funnel_upload_chunks enable row level security;
-- The service role also uses the narrow RPCs, not arbitrary staging mutations.
revoke all on public.close_funnel_uploads,public.close_funnel_upload_chunks from public,anon,authenticated,service_role;

create function public.cleanup_close_funnel_uploads(p_limit integer default 2)
returns integer language plpgsql security definer set search_path='' set jit=off as $$
declare v_deleted integer;
begin
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid funnel cleanup limit';end if;
 with expired as (
  select run_id from public.close_funnel_uploads where expires_at<now()
  order by expires_at limit p_limit for update skip locked
 ), removed as (
  delete from public.close_funnel_uploads u using expired e where u.run_id=e.run_id returning 1
 ) select count(*)::integer into v_deleted from removed;
 return v_deleted;
end;$$;

create function public.begin_close_funnel_upload(p_run_id uuid,p_snapshot_started_at timestamptz,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare
 v_keys constant text[]:=array['p_start_date','p_end_date','p_snapshot_started_at','p_raw','p_facts','p_opportunities','p_leads','p_bookings','p_meetings','p_calendar_leads','p_events','p_processes','p_meeting_relations','p_event_relations','p_funnel_leads','p_status_created_since'];
 v_scalars constant text[]:=array['p_start_date','p_end_date','p_snapshot_started_at','p_status_created_since'];
 v_section text;v_spec jsonb;v_chunk jsonb;v_rows bigint;v_chunks bigint:=0;v_bytes bigint:=0;
 v_existing public.close_funnel_uploads%rowtype;
begin
 if p_run_id is null or p_snapshot_started_at is null then raise exception 'Invalid funnel upload identity';end if;
 if jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>262144
 then raise exception 'Invalid funnel upload manifest';end if;
 if not p_manifest ?& v_keys or exists(select 1 from jsonb_object_keys(p_manifest) k where not k=any(v_keys))
 then raise exception 'Invalid funnel upload sections';end if;
 foreach v_section in array v_keys loop
  v_spec:=p_manifest->v_section;
  if jsonb_typeof(v_spec) is distinct from 'object' or not v_spec ?& array['rows','chunks']
   or exists(select 1 from jsonb_object_keys(v_spec) k where k not in ('rows','chunks'))
   or jsonb_typeof(v_spec->'chunks') is distinct from 'array'
   or coalesce(v_spec->>'rows','') !~ '^(0|[1-9][0-9]{0,6})$'
  then raise exception 'Invalid funnel section manifest';end if;
  if jsonb_array_length(v_spec->'chunks') not between 1 and 1024 then raise exception 'Invalid funnel chunk count';end if;
  v_rows:=0;
  for v_chunk in select value from jsonb_array_elements(v_spec->'chunks') loop
   if jsonb_typeof(v_chunk) is distinct from 'object' or not v_chunk ?& array['sha256','bytes','rows']
    or exists(select 1 from jsonb_object_keys(v_chunk) k where k not in ('sha256','bytes','rows'))
    or coalesce(v_chunk->>'sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(v_chunk->>'bytes','') !~ '^[1-9][0-9]{0,5}$'
    or coalesce(v_chunk->>'rows','') !~ '^(0|[1-9][0-9]{0,6})$'
   then raise exception 'Invalid funnel chunk manifest';end if;
   if (v_chunk->>'bytes')::integer>262144 then raise exception 'Funnel chunk is too large';end if;
   v_bytes:=v_bytes+(v_chunk->>'bytes')::integer;
   v_rows:=v_rows+(v_chunk->>'rows')::integer;
   v_chunks:=v_chunks+1;
  end loop;
  if v_rows<>(v_spec->>'rows')::integer or v_rows>200000 then raise exception 'Invalid funnel row count';end if;
  if v_section=any(v_scalars) and (v_rows<>1 or jsonb_array_length(v_spec->'chunks')<>1)
  then raise exception 'Invalid funnel scalar manifest';end if;
 end loop;
 if v_bytes>67108864 or v_chunks>1024 then raise exception 'Funnel upload exceeds bounded capacity';end if;
 -- An uncertain successful finalize may be retried after a newer sync. Its
 -- immutable manifest is still checked before returning the committed result.
 select * into v_existing from public.close_funnel_uploads where run_id=p_run_id for update;
 if found then
  if v_existing.snapshot_started_at<>p_snapshot_started_at or v_existing.manifest<>p_manifest
  then raise exception 'Conflicting funnel upload identity';end if;
  if v_existing.state='committed' then return jsonb_build_object('state','committed','result',v_existing.result);end if;
  if v_existing.expires_at<now() then raise exception 'Expired funnel upload';end if;
  return jsonb_build_object('state','uploading');
 end if;
 if p_snapshot_started_at<now()-interval '30 minutes' or p_snapshot_started_at>now()+interval '1 minute'
 then raise exception 'Invalid funnel upload snapshot time';end if;
 perform public.cleanup_close_funnel_uploads(2);
 insert into public.close_funnel_uploads(run_id,snapshot_started_at,manifest,expires_at)
 values(p_run_id,p_snapshot_started_at,p_manifest,p_snapshot_started_at+interval '30 minutes')
 on conflict(run_id) do nothing;
 -- Concurrent Begin calls must prove the same immutable declaration.
 select * into v_existing from public.close_funnel_uploads where run_id=p_run_id for update;
 if v_existing.snapshot_started_at<>p_snapshot_started_at or v_existing.manifest<>p_manifest
 then raise exception 'Conflicting funnel upload identity';end if;
 return jsonb_build_object('state',v_existing.state,'result',v_existing.result);
end;$$;

create function public.put_close_funnel_upload_chunk(p_run_id uuid,p_section text,p_chunk_index integer,p_payload_text text)
returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare
 v_upload public.close_funnel_uploads%rowtype;v_expected jsonb;v_payload jsonb;
 v_hash text;v_bytes integer;v_rows integer;v_existing public.close_funnel_upload_chunks%rowtype;
 v_scalars constant text[]:=array['p_start_date','p_end_date','p_snapshot_started_at','p_status_created_since'];
begin
 if p_payload_text is null or octet_length(p_payload_text) not between 1 and 262144
 then raise exception 'Invalid funnel chunk size';end if;
 select * into v_upload from public.close_funnel_uploads where run_id=p_run_id for update;
 if not found then raise exception 'Unknown funnel upload';end if;
 if v_upload.expires_at<now() then raise exception 'Expired funnel upload';end if;
 if p_section is null or p_chunk_index is null or p_chunk_index<0 or not v_upload.manifest ? p_section
 then raise exception 'Unexpected funnel chunk';end if;
 v_expected:=v_upload.manifest->p_section->'chunks'->p_chunk_index;
 if v_expected is null then raise exception 'Unexpected funnel chunk';end if;
 v_bytes:=octet_length(p_payload_text);
 v_hash:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
 if v_hash<>v_expected->>'sha256' or v_bytes<>(v_expected->>'bytes')::integer
 then raise exception 'Funnel chunk checksum mismatch';end if;
 begin v_payload:=p_payload_text::jsonb;exception when invalid_text_representation then raise exception 'Invalid funnel chunk JSON';end;
 if p_section=any(v_scalars) then
  if jsonb_typeof(v_payload) is distinct from 'string' then raise exception 'Invalid funnel scalar chunk';end if;
  v_rows:=1;
 else
  if jsonb_typeof(v_payload) is distinct from 'array' then raise exception 'Invalid funnel array chunk';end if;
  v_rows:=jsonb_array_length(v_payload);
 end if;
 if v_rows<>(v_expected->>'rows')::integer then raise exception 'Funnel chunk row count mismatch';end if;
 select * into v_existing from public.close_funnel_upload_chunks where run_id=p_run_id and section=p_section and chunk_index=p_chunk_index;
 if found then
  if v_existing.sha256<>v_hash or v_existing.payload_text<>p_payload_text or v_existing.payload_bytes<>v_bytes or v_existing.row_count<>v_rows
  then raise exception 'Conflicting funnel chunk';end if;
  return jsonb_build_object('state',v_upload.state,'stored',false);
 end if;
 if v_upload.state='committed' then raise exception 'Committed funnel upload is immutable';end if;
 insert into public.close_funnel_upload_chunks(run_id,section,chunk_index,sha256,payload_bytes,row_count,payload_text)
 values(p_run_id,p_section,p_chunk_index,v_hash,v_bytes,v_rows,p_payload_text);
 return jsonb_build_object('state','uploading','stored',true);
end;$$;

create function public.finalize_close_funnel_upload(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare
 v_upload public.close_funnel_uploads%rowtype;v_section text;v_spec jsonb;v_payload jsonb;v_snapshot jsonb:='{}';v_result jsonb;
 v_scalars constant text[]:=array['p_start_date','p_end_date','p_snapshot_started_at','p_status_created_since'];
 v_started timestamptz:=clock_timestamp();
begin
 raise log 'close_funnel_upload phase=finalize_entered';
 select * into v_upload from public.close_funnel_uploads where run_id=p_run_id for update;
 if not found then raise exception 'Unknown funnel upload';end if;
 if v_upload.state='committed' then return v_upload.result;end if;
 if v_upload.expires_at<now() then raise exception 'Expired funnel upload';end if;
 if exists(
  select 1 from jsonb_each(v_upload.manifest) s
  cross join lateral jsonb_array_elements(s.value->'chunks') with ordinality e(value,ordinality)
  left join public.close_funnel_upload_chunks c on c.run_id=p_run_id and c.section=s.key and c.chunk_index=e.ordinality-1
  where c.run_id is null or c.sha256<>e.value->>'sha256' or c.payload_bytes<>(e.value->>'bytes')::integer or c.row_count<>(e.value->>'rows')::integer
   or encode(sha256(convert_to(c.payload_text,'UTF8')),'hex')<>c.sha256 or octet_length(c.payload_text)<>c.payload_bytes
 ) or (select count(*) from public.close_funnel_upload_chunks where run_id=p_run_id)<>
 (select sum(jsonb_array_length(value->'chunks')) from jsonb_each(v_upload.manifest))
 then raise exception 'Incomplete or inconsistent funnel upload';end if;
 for v_section,v_spec in select key,value from jsonb_each(v_upload.manifest) loop
  if v_section=any(v_scalars) then
   select payload_text::jsonb into v_payload from public.close_funnel_upload_chunks where run_id=p_run_id and section=v_section and chunk_index=0;
  else
   select coalesce(jsonb_agg(e.value order by c.chunk_index,e.ordinality),'[]'::jsonb) into v_payload
   from public.close_funnel_upload_chunks c
   cross join lateral jsonb_array_elements(c.payload_text::jsonb) with ordinality e(value,ordinality)
   where c.run_id=p_run_id and c.section=v_section;
   if jsonb_array_length(v_payload)<>(v_spec->>'rows')::integer then raise exception 'Funnel assembled row count mismatch';end if;
  end if;
  v_snapshot:=v_snapshot||jsonb_build_object(v_section,v_payload);
 end loop;
 if (v_snapshot->>'p_snapshot_started_at')::timestamptz<>v_upload.snapshot_started_at
 then raise exception 'Funnel snapshot time mismatch';end if;
 raise log 'close_funnel_upload phase=assembled elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started)*1000);
 -- Existing stale-snapshot, attribution, source and calendar guards remain the
 -- only publication path. Any error rolls back reporting AND committed state.
 v_result:=public.reconcile_close_funnel_payload(v_snapshot);
 update public.close_funnel_uploads set state='committed',committed_at=now(),result=v_result,expires_at=now()+interval '1 day' where run_id=p_run_id;
 -- Source content has served its purpose. Keep only the immutable manifest and
 -- cached result for safe finalization retries; an upload is never re-published.
 delete from public.close_funnel_upload_chunks where run_id=p_run_id;
 raise log 'close_funnel_upload phase=committed elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started)*1000);
 return v_result;
end;$$;

revoke all on function public.cleanup_close_funnel_uploads(integer),public.begin_close_funnel_upload(uuid,timestamptz,jsonb),public.put_close_funnel_upload_chunk(uuid,text,integer,text),public.finalize_close_funnel_upload(uuid) from public,anon,authenticated;
grant execute on function public.cleanup_close_funnel_uploads(integer),public.begin_close_funnel_upload(uuid,timestamptz,jsonb),public.put_close_funnel_upload_chunk(uuid,text,integer,text),public.finalize_close_funnel_upload(uuid) to service_role;
commit;
