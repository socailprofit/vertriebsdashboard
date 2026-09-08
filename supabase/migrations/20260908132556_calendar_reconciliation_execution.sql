begin;
-- Keep short snapshot transactions below the Data API statement limit without
-- changing validation, lock, rollback or retry semantics. Production rollback
-- benchmark: ~1.40 s with JIT versus ~1.06 s without compilation overhead.
alter function public.reconcile_close_calendar_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) set jit=off;
alter function public.reconcile_close_sales_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) set jit=off;
alter function public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb) set jit=off;
commit;
