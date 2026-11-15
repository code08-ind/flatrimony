-- 0003 — Reference tables + production seed (docs/04-database-design.md §6.1, §8.1, §14).
-- Only values written down in the docs are seeded here. Content the founder still has to
-- provide (area boundaries, scenario questions, habit tag translations, product prices)
-- lives in supabase/seed.sql for local development only.

-- Shared updated_at trigger (docs/04 §8.1).
create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table ref.areas (
  id           smallserial primary key,
  slug         text not null unique,                -- 'gurugram-cyber-city'
  name_en      text not null,
  name_hi      text not null,
  city         text not null check (city in ('delhi','gurugram','noida','greater_noida','ghaziabad','faridabad')),
  centroid     geography(Point, 4326) not null,
  boundary     geography(MultiPolygon, 4326),
  is_active    boolean not null default true,
  constraint areas_slug_format_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index areas_boundary_idx on ref.areas using gist (boundary);
comment on table ref.areas is 'NCR localities. Centroids/boundaries from OpenStreetMap (attribution in the app About screen).';

create table ref.habit_tags (
  id           text primary key,                    -- 'tidy', 'quiet_after_11', 'pays_on_time', 'respects_guest_rule'
  label_en     text not null,
  label_hi     text not null,
  attribute    public.lifestyle_attribute,          -- null for general tags like pays_on_time
  sort_order   smallint not null default 0,
  is_active    boolean not null default true
);

create table ref.scenario_questions (
  id           text primary key,                    -- 'sink_dishes_10pm'
  attribute    public.lifestyle_attribute not null,
  prompt_en    text not null,
  prompt_hi    text not null,
  options      jsonb not null,                      -- [{ "id", "label_en", "label_hi", "value" in 0..1 }]
  sort_order   smallint not null default 0,
  is_active    boolean not null default true,
  constraint scenario_questions_options_chk check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5)
);

create table ref.products (
  code          public.product_code primary key,
  name_en       text not null,
  name_hi       text not null,
  price_paise   bigint not null check (price_paise > 0),
  duration_days smallint not null check (duration_days > 0),
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now()
);
comment on table ref.products is 'Paid products (v1.1). Prices are set by the founder; never seeded with invented values.';

create table ref.app_config (
  key          text primary key,                    -- 'daily_like_limit', 'feature.house_agreement'
  value        jsonb not null,
  is_public    boolean not null default false,      -- public keys readable by clients
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create trigger products_set_updated_at before update on ref.products
  for each row execute function public.set_updated_at();
create trigger app_config_set_updated_at before update on ref.app_config
  for each row execute function public.set_updated_at();

-- Access: ref is read-only for clients; app_config rows only when is_public.
alter table ref.areas              enable row level security;
alter table ref.habit_tags         enable row level security;
alter table ref.scenario_questions enable row level security;
alter table ref.products           enable row level security;
alter table ref.app_config         enable row level security;

create policy areas_read              on ref.areas              for select to anon, authenticated using (is_active);
create policy habit_tags_read         on ref.habit_tags         for select to anon, authenticated using (is_active);
create policy scenario_questions_read on ref.scenario_questions for select to anon, authenticated using (is_active);
create policy products_read           on ref.products           for select to anon, authenticated using (is_active);
create policy app_config_read_public  on ref.app_config         for select to anon, authenticated using (is_public);

grant usage on schema ref to anon, authenticated;
grant select on all tables in schema ref to anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema ref from anon, authenticated;

-- Seed: values stated in docs/04 §14, docs/02 FR-DISC-08 / FR-CHAT-04 / FR-LST-07 and docs/05 §8.1.
-- They are initial values the founder can change via admin (FR-ADM-07).
insert into ref.app_config (key, value, is_public, description) values
  ('daily_like_limit',                 '50'::jsonb,      true,  'Free daily likes (FR-DISC-08)'),
  ('new_account_daily_conversations',  '10'::jsonb,      false, 'New-account cap on first messages per day (FR-CHAT-04)'),
  ('listing_confirm_days',             '7'::jsonb,       false, 'Days before an unconfirmed listing expires (FR-LST-07)'),
  ('min_supported_app_version',        '"1.0.0"'::jsonb, true,  'Clients below this show a forced-update screen'),
  ('feature.video_tours',              'false'::jsonb,   true,  'Live video tours (v1.1)'),
  ('feature.house_agreement',          'false'::jsonb,   true,  'House agreement (v1.2)');
