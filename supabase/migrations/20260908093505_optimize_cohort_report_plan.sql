begin;
-- These small, correlated dashboard aggregates spent seconds compiling JIT
-- code instead of returning rows. EXPLAIN ANALYZE with the real snapshot:
-- process report ~5.4 s with JIT; entire protected report ~0.97 s without it.
-- Scope this to reporting functions, preserving all role and timeout limits.
alter function public.get_antony_report(text,date) set jit=off;
alter function public.get_antony_process_metrics_internal(text,date) set jit=off;
commit;
