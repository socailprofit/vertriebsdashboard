begin;
-- Preserve the existing atomic publication and cached result. Deleting TOASTed
-- upload payloads is maintenance, and must not consume its transaction budget.
create or replace function public.finalize_close_funnel_upload(p_run_id uuid)
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
 -- Payload cleanup runs in a separate transaction after this publication.
 raise log 'close_funnel_upload phase=committed elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started)*1000);
 return v_result;
end;$$;

create function public.cleanup_close_funnel_upload_chunks(p_limit integer default 16)
returns integer language plpgsql security definer set search_path='' set jit=off as $$
declare v_deleted integer;
begin
 if p_limit is null or p_limit not between 1 and 128 then raise exception 'Invalid funnel chunk cleanup limit';end if;
 with candidates as (
  select c.run_id,c.section,c.chunk_index from public.close_funnel_upload_chunks c
  join public.close_funnel_uploads u on u.run_id=c.run_id
  where u.state='committed'
  order by u.committed_at,c.run_id,c.section,c.chunk_index
  limit p_limit for update of c skip locked
 ), removed as (
  delete from public.close_funnel_upload_chunks c using candidates n
  where c.run_id=n.run_id and c.section=n.section and c.chunk_index=n.chunk_index returning 1
 ) select count(*)::integer into v_deleted from removed;
 return v_deleted;
end;$$;
revoke all on function public.cleanup_close_funnel_upload_chunks(integer) from public,anon,authenticated;
grant execute on function public.cleanup_close_funnel_upload_chunks(integer) to service_role;
commit;
