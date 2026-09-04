begin;

-- Der Zielrechner ist optional. Die operativen Close-Kennzahlen bleiben davon
-- unberuehrt; gespeichert werden nur Antonys Planungseingaben je Zeitraum.
create table if not exists public.antony_performance_goals (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('day', 'week', 'month')),
  period_start date not null,
  period_end date not null,
  target_new_customers integer not null default 0 check (target_new_customers >= 0),
  target_revenue_cents bigint not null default 0 check (target_revenue_cents >= 0),
  customer_value_cents bigint not null check (customer_value_cents > 0),
  appointment_to_closer_rate_override numeric check (
    appointment_to_closer_rate_override is null
    or appointment_to_closer_rate_override > 0 and appointment_to_closer_rate_override <= 100
  ),
  show_rate_override numeric check (
    show_rate_override is null or show_rate_override > 0 and show_rate_override <= 100
  ),
  closing_rate_override numeric check (
    closing_rate_override is null or closing_rate_override > 0 and closing_rate_override <= 100
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint antony_performance_goals_period_check check (period_end >= period_start),
  constraint antony_performance_goals_owner_period_key unique (owner_user_id, period_type, period_start)
);

create index if not exists antony_performance_goals_owner_period_idx
  on public.antony_performance_goals (owner_user_id, period_start desc);

drop trigger if exists antony_performance_goals_set_updated_at on public.antony_performance_goals;
create trigger antony_performance_goals_set_updated_at
before update on public.antony_performance_goals
for each row execute function public.set_updated_at();

alter table public.antony_performance_goals enable row level security;

revoke all on public.antony_performance_goals from public, anon;
grant select, insert, update, delete on public.antony_performance_goals to authenticated;

drop policy if exists antony_performance_goals_owner_read on public.antony_performance_goals;
create policy antony_performance_goals_owner_read
on public.antony_performance_goals for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
);

drop policy if exists antony_performance_goals_leads_insert on public.antony_performance_goals;
create policy antony_performance_goals_leads_insert
on public.antony_performance_goals for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

drop policy if exists antony_performance_goals_leads_update on public.antony_performance_goals;
create policy antony_performance_goals_leads_update
on public.antony_performance_goals for update
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
)
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

drop policy if exists antony_performance_goals_leads_delete on public.antony_performance_goals;
create policy antony_performance_goals_leads_delete
on public.antony_performance_goals for delete
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

commit;
