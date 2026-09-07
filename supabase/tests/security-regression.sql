-- Run only as a database administrator. All fixtures are rolled back.
begin;
set local statement_timeout = '15s';
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
values (auth.uid(), 'security-audit-' || auth.uid() || '@example.invalid',
        'audit-fixture-initial-not-a-real-hash', '{}');
insert into public.sales_people (id, close_user_id, slug, display_name, color, active)
values (auth.uid(), 'audit-' || auth.uid(), 'audit-' || auth.uid(), 'Audit fixture', '#123456', false);

set local role authenticated;
do $$
begin
  if public.has_dashboard_access() then raise exception 'Pending account is unlocked'; end if;
  begin
    perform public.complete_personal_password_setup();
    raise exception 'Password setup bypass remains';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.sales_people) then raise exception 'Pending account sees people'; end if;
  if exists (select 1 from public.get_dashboard_metrics('day', current_date)) then
    raise exception 'Pending account sees metrics';
  end if;
  begin
    update public.profiles set must_change_password = false where user_id = auth.uid();
    raise exception 'Client can update password gate';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'operator' where user_id = auth.uid();
    raise exception 'Client can promote itself';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

update auth.users set raw_user_meta_data = '{"role":"operator","must_change_password":false}' where id = auth.uid();
update auth.users set encrypted_password = encrypted_password where id = auth.uid();
do $$ begin
  if public.has_dashboard_access() then raise exception 'Metadata or unchanged password unlocked account'; end if;
end; $$;

-- Simulate the Auth password write; only this synthetic account is touched.
update auth.users set encrypted_password = 'audit-fixture-changed-not-a-real-hash' where id = auth.uid();
set local role authenticated;
do $$
begin
  perform public.complete_personal_password_setup();
  if not public.has_dashboard_access() then raise exception 'Password change did not unlock account'; end if;
  if public.current_app_role() <> 'sales' then raise exception 'Metadata changed role'; end if;
  if not exists (select 1 from public.sales_people) then raise exception 'Ready sales account cannot read people'; end if;
  if public.has_antony_access() then raise exception 'Sales account sees leadership'; end if;
  begin
    insert into public.sales_targets (sales_person_id, period_start, period_end, created_by)
    values (auth.uid(), current_date, current_date, auth.uid());
    raise exception 'Sales account can write targets';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_antony_closing_metrics('day', current_date);
    raise exception 'Sales account reads Antony RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.close_raw_activities;
    raise exception 'Sales account reads raw CRM';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Verify that even a manager cannot rewrite roles or the password gate.
update public.profiles set role = 'manager' where user_id = auth.uid();
set local role authenticated;
do $$ begin
  update public.profiles set display_name = 'Security fixture' where user_id = auth.uid();
  insert into public.sales_targets (sales_person_id, period_start, period_end, created_by)
  values (auth.uid(), current_date, current_date, auth.uid());
  update public.sales_targets set calls_net = 7 where sales_person_id = auth.uid();
  if not exists (select 1 from public.sales_targets where sales_person_id = auth.uid() and calls_net = 7) then
    raise exception 'Manager targets workflow failed';
  end if;
  delete from public.sales_targets where sales_person_id = auth.uid();
  begin
    update public.profiles set role = 'operator' where user_id = auth.uid();
    raise exception 'Manager can grant backend role';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;

do $$ declare item record; client_role text;
begin
  foreach client_role in array array['anon','authenticated'] loop
    for item in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v') loop
      if has_table_privilege(client_role,item.oid,'TRUNCATE')
         or has_table_privilege(client_role,item.oid,'TRIGGER')
         or has_table_privilege(client_role,item.oid,'REFERENCES') then
        raise exception 'Excess table privilege remains';
      end if;
    end loop;
    if has_function_privilege(client_role,'public.handle_new_user()','EXECUTE')
       or has_function_privilege(client_role,'public.record_personal_password_change()','EXECUTE')
       or has_function_privilege(client_role,'public.rls_auto_enable()','EXECUTE') then
      raise exception 'Internal trigger callable by client';
    end if;
  end loop;
end; $$;
select 'security regression assertions passed; fixtures rolled back' as result;
rollback;
