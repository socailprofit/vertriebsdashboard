-- The importer only reads the active roster; browser rights and RLS stay unchanged.
grant select (slug, close_user_id, active, sort_order) on public.sales_people to service_role;
