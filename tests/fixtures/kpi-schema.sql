create table public.sales_people (
id uuid not null default extensions.gen_random_uuid(),
close_user_id text not null,
slug text not null,
display_name text not null,
color text not null,
active boolean not null default true,
sort_order smallint not null default 0,
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone not null default now()
);
alter table public.sales_people add UNIQUE (close_user_id);
alter table public.sales_people add PRIMARY KEY (id);
alter table public.sales_people add UNIQUE (slug);
create table public.close_raw_activities (
close_activity_id text not null,
activity_type text not null,
close_user_id text,
lead_id text,
occurred_at timestamp with time zone not null,
payload jsonb not null,
ingested_at timestamp with time zone not null default now()
);
alter table public.close_raw_activities add PRIMARY KEY (close_activity_id);
create table public.close_activity_facts (
source_activity_id text not null,
source_type text not null,
close_user_id text,
lead_id text,
occurred_at timestamp with time zone not null,
metric_date date not null,
metric_hour smallint not null,
calls_gross smallint not null default 0,
calls_net smallint not null default 0,
talk_seconds integer not null default 0,
gatekeeper_contacts smallint not null default 0,
connected_calls smallint not null default 0,
direct_decision_maker_calls smallint not null default 0,
decision_maker_contacts smallint not null default 0,
appointments smallint not null default 0,
setter_calls smallint not null default 0,
setter_successes smallint not null default 0,
closer_calls smallint not null default 0,
closer_sales smallint not null default 0,
no_shows smallint not null default 0,
cancellations smallint not null default 0,
rescheduled_appointments smallint not null default 0,
product_focus text,
mapping_version text not null,
mapped_at timestamp with time zone not null default now(),
closer_second_calls smallint not null default 0
);
alter table public.close_activity_facts add CHECK (((appointments >= 0) AND (appointments <= 1)));
alter table public.close_activity_facts add CHECK (((calls_gross >= 0) AND (calls_gross <= 1)));
alter table public.close_activity_facts add CHECK (((calls_net >= 0) AND (calls_net <= 1)));
alter table public.close_activity_facts add CHECK (((cancellations >= 0) AND (cancellations <= 1)));
alter table public.close_activity_facts add CHECK (((closer_calls >= 0) AND (closer_calls <= 1)));
alter table public.close_activity_facts add CHECK (((closer_sales >= 0) AND (closer_sales <= 1)));
alter table public.close_activity_facts add CHECK (((closer_second_calls >= 0) AND (closer_second_calls <= 1)));
alter table public.close_activity_facts add CHECK (((connected_calls >= 0) AND (connected_calls <= 1)));
alter table public.close_activity_facts add CHECK (((decision_maker_contacts >= 0) AND (decision_maker_contacts <= 1)));
alter table public.close_activity_facts add CHECK (((direct_decision_maker_calls >= 0) AND (direct_decision_maker_calls <= 1)));
alter table public.close_activity_facts add CHECK (((gatekeeper_contacts >= 0) AND (gatekeeper_contacts <= 1)));
alter table public.close_activity_facts add CHECK (((metric_hour >= 0) AND (metric_hour <= 23)));
alter table public.close_activity_facts add CHECK (((no_shows >= 0) AND (no_shows <= 1)));
alter table public.close_activity_facts add PRIMARY KEY (source_activity_id);
alter table public.close_activity_facts add CHECK (((rescheduled_appointments >= 0) AND (rescheduled_appointments <= 1)));
alter table public.close_activity_facts add CHECK (((setter_calls >= 0) AND (setter_calls <= 1)));
alter table public.close_activity_facts add CHECK (((setter_successes >= 0) AND (setter_successes <= 1)));
alter table public.close_activity_facts add CHECK ((source_type = ANY (ARRAY['call'::text, 'custom_activity'::text])));
alter table public.close_activity_facts add CHECK ((talk_seconds >= 0));
create table public.close_opportunity_facts (
opportunity_id text not null,
lead_id text not null,
opener_close_user_id text not null,
setter_close_user_id text,
closer_close_user_id text,
won_at timestamp with time zone not null,
won_date date not null,
status_id text not null,
value_cents bigint not null default 0,
value_period text not null,
mapping_version text not null,
payload jsonb not null,
ingested_at timestamp with time zone not null default now()
);
alter table public.close_opportunity_facts add PRIMARY KEY (opportunity_id);
alter table public.close_opportunity_facts add CHECK ((value_cents >= 0));
alter table public.close_opportunity_facts add CHECK ((value_period = ANY (ARRAY['one_time'::text, 'monthly'::text, 'annual'::text])));
create table public.daily_sales_metrics (
metric_date date not null,
sales_person_id uuid not null,
calls_gross integer not null default 0,
calls_net integer not null default 0,
talk_seconds integer not null default 0,
gatekeeper_contacts integer not null default 0,
connected_calls integer not null default 0,
direct_decision_maker_calls integer not null default 0,
decision_maker_contacts integer not null default 0,
appointments integer not null default 0,
setter_calls integer not null default 0,
setter_successes integer not null default 0,
closer_calls integer not null default 0,
closer_sales integer not null default 0,
no_shows integer not null default 0,
cancellations integer not null default 0,
rescheduled_appointments integer not null default 0,
deals_won integer not null default 0,
revenue_cents bigint not null default 0,
newsletters integer,
calculated_at timestamp with time zone not null default now()
);
alter table public.daily_sales_metrics add CHECK ((appointments >= 0));
alter table public.daily_sales_metrics add CHECK ((calls_gross >= 0));
alter table public.daily_sales_metrics add CHECK ((calls_net >= 0));
alter table public.daily_sales_metrics add CHECK ((cancellations >= 0));
alter table public.daily_sales_metrics add CHECK ((closer_calls >= 0));
alter table public.daily_sales_metrics add CHECK ((closer_sales >= 0));
alter table public.daily_sales_metrics add CHECK ((connected_calls >= 0));
alter table public.daily_sales_metrics add CHECK ((deals_won >= 0));
alter table public.daily_sales_metrics add CHECK ((decision_maker_contacts >= 0));
alter table public.daily_sales_metrics add CHECK ((direct_decision_maker_calls >= 0));
alter table public.daily_sales_metrics add CHECK ((gatekeeper_contacts >= 0));
alter table public.daily_sales_metrics add CHECK ((newsletters >= 0));
alter table public.daily_sales_metrics add CHECK ((no_shows >= 0));
alter table public.daily_sales_metrics add PRIMARY KEY (metric_date, sales_person_id);
alter table public.daily_sales_metrics add CHECK ((rescheduled_appointments >= 0));
alter table public.daily_sales_metrics add CHECK ((revenue_cents >= 0));
alter table public.daily_sales_metrics add CHECK ((setter_calls >= 0));
alter table public.daily_sales_metrics add CHECK ((setter_successes >= 0));
alter table public.daily_sales_metrics add CHECK ((talk_seconds >= 0));
create table public.monthly_kpi_snapshots (
month_start date not null,
calls_gross bigint not null default 0,
calls_net bigint not null default 0,
gatekeeper_contacts bigint not null default 0,
connected_calls bigint not null default 0,
direct_decision_maker_calls bigint not null default 0,
decision_maker_contacts bigint not null default 0,
appointments bigint not null default 0,
newsletters bigint not null default 0,
snapshotted_at timestamp with time zone not null default now()
);
alter table public.monthly_kpi_snapshots add CHECK ((direct_decision_maker_calls >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((decision_maker_contacts >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((appointments >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((calls_gross >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((calls_net >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((connected_calls >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((gatekeeper_contacts >= 0));
alter table public.monthly_kpi_snapshots add CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp with time zone))::date));
alter table public.monthly_kpi_snapshots add CHECK ((newsletters >= 0));
alter table public.monthly_kpi_snapshots add PRIMARY KEY (month_start);
create table public.close_newsletter_sends (
close_email_id text not null,
workflow_id text not null default 'seq_1CghCZOXaNSlwDSOIpljTy'::text,
close_user_id text,
sent_at timestamp with time zone not null,
mapping_version text not null
);
alter table public.close_newsletter_sends add PRIMARY KEY (close_email_id);
alter table public.close_newsletter_sends add CHECK ((workflow_id = 'seq_1CghCZOXaNSlwDSOIpljTy'::text));
