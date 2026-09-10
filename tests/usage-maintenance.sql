-- Run with an administrative SQL connection. Every write is rolled back.
begin;
set local statement_timeout='15s';
do $$
declare
 v_run uuid:=gen_random_uuid();v_before jsonb:='{}';v_after jsonb:='{}';
 v_table text;v_hash text;v_deleted integer;
 v_tables text[]:=array['daily_sales_metrics','monthly_kpi_snapshots',
  'close_activity_facts','close_funnel_events','close_funnel_observations',
  'close_sales_processes','close_process_events','close_booking_history','close_meetings'];
begin
 foreach v_table in array v_tables loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,'''' order by to_jsonb(t)::text),'''')) from public.%I t',v_table) into v_hash;
  v_before:=v_before||jsonb_build_object(v_table,v_hash);
 end loop;
 insert into public.close_funnel_uploads(run_id,snapshot_started_at,manifest,expires_at)
 values(v_run,now(),'{}',now()+interval '1 hour');
 insert into public.close_funnel_upload_chunks(run_id,section,chunk_index,sha256,payload_bytes,row_count,payload_text)
 values(v_run,'p_raw',0,repeat('0',64),2,0,'[]');
 v_deleted:=public.cleanup_close_funnel_upload_chunks(128);
 if v_deleted not between 0 and 128 then raise exception 'Cleanup exceeded batch bound';end if;
 if not exists(select 1 from public.close_funnel_upload_chunks where run_id=v_run) then
  raise exception 'Active upload was removed';
 end if;
 foreach v_table in array v_tables loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,'''' order by to_jsonb(t)::text),'''')) from public.%I t',v_table) into v_hash;
  v_after:=v_after||jsonb_build_object(v_table,v_hash);
 end loop;
 if v_before<>v_after then raise exception 'Reporting data changed during cleanup';end if;
 if has_function_privilege('anon','public.cleanup_close_funnel_upload_chunks(integer)','execute')
  or has_function_privilege('authenticated','public.cleanup_close_funnel_upload_chunks(integer)','execute') then
  raise exception 'Maintenance RPC exposed to browser roles';
 end if;
end;$$;
select 'passed: bounded cleanup, active upload retained, nine reporting tables unchanged, no browser access' as verification;
rollback;
