begin;
-- One protected combined report includes current inventory and three periods.
-- Scope the documented PostgREST timeout override to that RPC only.
alter function public.get_antony_report(text,date) set statement_timeout='20s';
notify pgrst,'reload schema';
notify pgrst,'reload config';
commit;
