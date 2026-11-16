-- 0004 — Profiles and Flat Biodata (docs/04-database-design.md §6.2, §7, §8.4, §9; T2.1).
--
-- Access model (docs/04 §2, ADR-0004): clients never write; the API writes after its own checks.
-- Supabase's default privileges give anon/authenticated full rights on every new object in
-- `public`, so this migration (a) revokes those defaults for all FUTURE objects and (b) revokes
-- them on the tables created here, instead of waiting for 0013. RLS is enabled on every table.
-- Clients may read only their OWN profile, preferences, lifestyle and anchor (docs/04 §7).
-- Other users' data is served only by the API discovery endpoints (women-only and block rules).

-- ---------------------------------------------------------------------------
-- Default privileges: nothing new in public/ref is reachable by clients unless granted explicitly.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema ref    revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema ref    revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema ref    revoke execute on functions from public, anon, authenticated;

-- set_updated_at (0003) is a trigger function; clients have no reason to call it.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Current user id from the request JWT (set by PostgREST, or by the API with SET LOCAL; docs/04 §2.2).
-- Returns NULL (never an error) when claims are unset, '' (what a pooled connection holds after an
-- earlier SET LOCAL), missing `sub`, or a non-UUID `sub`. RLS then simply matches no rows.
create or replace function public.uid() returns uuid
language sql stable
set search_path = ''
as $$
  select case when s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then s::uuid end
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' as s) c
$$;
revoke execute on function public.uid() from public, anon;
grant execute on function public.uid() to authenticated;  -- used by RLS policies

-- Human-visible text: trimmed, at least one visible character, and no control, zero-width or
-- bidirectional-override characters (which allow invisible or spoofed names). Mirrored by the
-- `humanText` Zod helper in packages/shared.
create or replace function public.is_human_text(t text) returns boolean
language sql immutable
set search_path = ''
as $$
  select t = btrim(t, E' \t\n\r')
     and t ~ '[^[:space:]]'
     and t !~ '[\u0000-\u001F\u007F-\u009F­​-‏ -‮⁠-⁤﻿]'
$$;
-- Pure and harmless, and CHECK constraints need EXECUTE for whichever role writes (e.g. app_api).
grant execute on function public.is_human_text(text) to public;

-- "Max N rows per user" guard (docs/04 §8.4).
--  * SECURITY DEFINER so the count is never filtered by the caller's RLS (a writer role subject to
--    RLS could otherwise exceed the limit); search_path is pinned, as SECURITY DEFINER requires.
--  * A transaction-scoped advisory lock per (table, user) serialises concurrent writers. This relies
--    on READ COMMITTED (the default): the count then sees rows committed before the lock was taken.
--  * Fires on INSERT and on UPDATE OF user_id (moving rows to another user).
--  * Optional 2nd argument: the key column of the per-user unique key. If a row with the same key
--    already exists, the statement is an upsert/duplicate, not growth, so the guard lets it through
--    (ON CONFLICT or the unique constraint then decides).
create or replace function public.enforce_max_rows() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  key_exists boolean := false;
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_schema || '.' || tg_table_name), hashtext(new.user_id::text));
  if tg_nargs > 1 then
    execute format('select exists (select 1 from %I.%I where user_id = $1 and %I::text = $2)',
                   tg_table_schema, tg_table_name, tg_argv[1])
      into key_exists using new.user_id, to_jsonb(new) ->> tg_argv[1];
    if key_exists then
      return new;
    end if;
  end if;
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into n using new.user_id;
  if n >= tg_argv[0]::int then
    raise exception 'limit_exceeded' using errcode = 'P0001', detail = tg_table_name;
  end if;
  return new;
end $$;
revoke execute on function public.enforce_max_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text not null,
  date_of_birth        date,                                   -- self-declared until verified; replaced by verified DOB
  intent               public.user_intent not null,
  category             public.user_category not null default 'professional',
  bio                  text,
  languages            text[] not null default '{}',           -- ISO 639-1 codes: {'hi','en','pa'}
  locale               public.app_locale not null default 'en',
  verified_gender      public.verified_gender,                 -- set ONLY from the DigiLocker result (see 0005)
  is_identity_verified boolean not null default false,
  has_work_badge       boolean not null default false,
  has_college_badge    boolean not null default false,
  is_paused            boolean not null default false,
  biodata_completion   smallint not null default 0,
  college_name         text,                                   -- student category only (enforced by the API)
  course_end_date      date,                                   -- student category only (enforced by the API)
  last_active_at       timestamptz not null default now(),
  suspended_until      timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_display_name_chk check (char_length(display_name) between 1 and 40 and public.is_human_text(display_name)),
  constraint profiles_bio_chk check (char_length(bio) <= 300),
  constraint profiles_biodata_completion_chk check (biodata_completion between 0 and 100),
  constraint profiles_college_name_chk check (college_name is null or (char_length(college_name) between 1 and 120 and public.is_human_text(college_name))),
  -- Verified status and verified gender always go together; the value itself must match
  -- private.identity_records (constraint trigger in 0005).
  constraint profiles_verified_gender_chk check (is_identity_verified = (verified_gender is not null)),
  -- NULL-safe: with a plain `verified_gender = 'female'` a NULL gender makes the check NULL, which
  -- Postgres treats as passing.
  constraint profiles_women_only_chk check (category <> 'women_only' or verified_gender is not distinct from 'female' or is_identity_verified = false),
  -- 18+ (FR-BIO-01). current_date follows the session TimeZone (UTC on Supabase): someone turning 18
  -- between 00:00 and 05:30 IST is accepted a few hours late, never early.
  constraint profiles_adult_chk check (date_of_birth is null or (date_of_birth >= date '1900-01-01' and date_of_birth <= (current_date - interval '18 years'))),
  constraint profiles_languages_chk check (
    cardinality(languages) <= 10
    and array_position(languages, null) is null
    and (cardinality(languages) = 0 or array_to_string(languages, ',') ~ '^[a-z]{2}(,[a-z]{2})*$')
  )
);
comment on table public.profiles is 'Flat Biodata. verified_gender / is_identity_verified are written only from the DigiLocker result (FR-VER-06); a women_only user who is not verified exists but is invisible to everyone.';

create table public.profile_photos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  storage_path      text not null,                           -- '<user_id>/<uuid>.webp' in bucket 'profile-photos' (docs/04 §7.1)
  position          smallint not null,
  width             integer,
  height            integer,
  phash             bit(64),                                 -- perceptual hash
  has_face          boolean,
  moderation_status public.moderation_status not null default 'pending',
  created_at        timestamptz not null default now(),
  -- 6 positions x unique per user = at most 6 photos (FR-BIO-01). Not deferrable, so the API can
  -- upsert by position; reordering is done by the API inside one transaction.
  constraint profile_photos_user_id_position_key unique (user_id, position),
  constraint profile_photos_position_chk check (position between 0 and 5),
  constraint profile_photos_storage_path_chk check (storage_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')),
  constraint profile_photos_dimensions_chk check ((width is null or width > 0) and (height is null or height > 0))
);

create table public.preferences (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  budget_min_inr       integer not null,
  budget_max_inr       integer not null,
  move_in_from         date not null,
  move_in_to           date not null,
  lease_months         smallint not null default 11,
  flatmate_gender_pref public.gender_preference not null default 'any',
  updated_at           timestamptz not null default now(),
  constraint preferences_budget_min_chk check (budget_min_inr >= 1000),
  constraint preferences_budget_max_chk check (budget_max_inr <= 200000),
  constraint preferences_budget_chk check (budget_min_inr <= budget_max_inr),
  constraint preferences_dates_chk check (move_in_from <= move_in_to and isfinite(move_in_from) and isfinite(move_in_to)),
  constraint preferences_lease_months_chk check (lease_months between 1 and 36)
);

create table public.preference_areas (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  area_id   smallint not null references ref.areas(id),
  primary key (user_id, area_id)
);

create table public.anchors (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  kind             public.anchor_kind not null,
  label            text not null,                            -- 'Cyber City office'
  location         geography(Point, 4326) not null,
  travel_mode      public.travel_mode not null default 'metro_transit',
  max_commute_min  smallint not null default 45,
  updated_at       timestamptz not null default now(),
  constraint anchors_label_chk check (char_length(label) between 1 and 80 and public.is_human_text(label)),
  constraint anchors_max_commute_min_chk check (max_commute_min between 15 and 90)
);

create table public.commute_zones (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  travel_mode    public.travel_mode not null,
  max_minutes    smallint not null,
  zone           geography(MultiPolygon, 4326) not null,
  source         text not null default 'valhalla',
  computed_at    timestamptz not null default now(),
  constraint commute_zones_max_minutes_chk check (max_minutes between 15 and 90),
  constraint commute_zones_source_chk check (source in ('valhalla', 'fallback_radius'))
);

create table public.lifestyle (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  bedtime        time not null,
  wake_time      time not null,
  cleaning       public.cleaning_level not null,
  smoking        public.smoking_habit not null,
  pets           public.pet_attitude not null,
  food           public.food_habit not null,
  cooks_at_home  boolean,
  drinking       public.frequency_level,
  guests         public.frequency_level,
  parties        public.frequency_level,
  work_mode      public.work_mode,
  updated_at     timestamptz not null default now(),
  -- `time` accepts '24:00'; the app stores HH:mm in 00:00–23:59 (TimeOfDay in packages/shared).
  constraint lifestyle_times_chk check (bedtime < time '24:00' and wake_time < time '24:00')
);

create table public.lifestyle_importance (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  attribute   public.lifestyle_attribute not null,
  importance  public.importance_level not null default 'matters',
  primary key (user_id, attribute)
);

create table public.scenario_answers (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  question_id  text not null references ref.scenario_questions(id),
  option_id    text not null,
  answered_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- An answer must be one of the question's options (ref.scenario_questions.options[].id).
create or replace function public.validate_scenario_option() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from ref.scenario_questions q, jsonb_array_elements(q.options) o
    where q.id = new.question_id and o ->> 'id' = new.option_id
  ) then
    raise exception 'invalid_scenario_option' using errcode = '23514', detail = new.question_id;
  end if;
  return new;
end $$;
revoke execute on function public.validate_scenario_option() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes (docs/04 §9)
-- ---------------------------------------------------------------------------
create index commute_zones_zone_idx      on public.commute_zones using gist (zone);
create index anchors_location_idx        on public.anchors using gist (location);
create index preferences_budget_idx      on public.preferences (budget_min_inr, budget_max_inr);
create index preferences_move_in_idx     on public.preferences (move_in_from, move_in_to);
-- Deliberately no `suspended_until is null` predicate (docs/04 §9 has one): the discovery query
-- (§10) filters `suspended_until is null or suspended_until < now()`, which that partial index
-- could never serve.
create index profiles_discoverable_idx   on public.profiles (category, intent, last_active_at desc)
  where deleted_at is null and is_paused = false;
create index preference_areas_area_idx   on public.preference_areas (area_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger profiles_set_updated_at    before update on public.profiles    for each row execute function public.set_updated_at();
create trigger preferences_set_updated_at before update on public.preferences for each row execute function public.set_updated_at();
create trigger anchors_set_updated_at     before update on public.anchors     for each row execute function public.set_updated_at();
create trigger lifestyle_set_updated_at   before update on public.lifestyle   for each row execute function public.set_updated_at();

create trigger preference_areas_max before insert or update of user_id on public.preference_areas
  for each row execute function public.enforce_max_rows('3', 'area_id');

create trigger scenario_answers_valid_option before insert or update of question_id, option_id on public.scenario_answers
  for each row execute function public.validate_scenario_option();

-- ---------------------------------------------------------------------------
-- Access: RLS everywhere, no client writes, own-row reads only (docs/04 §7)
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.profile_photos       enable row level security;
alter table public.preferences          enable row level security;
alter table public.preference_areas     enable row level security;
alter table public.anchors              enable row level security;
alter table public.commute_zones        enable row level security;
alter table public.lifestyle            enable row level security;
alter table public.lifestyle_importance enable row level security;
alter table public.scenario_answers     enable row level security;

revoke all on public.profiles, public.profile_photos, public.preferences, public.preference_areas,
              public.anchors, public.commute_zones, public.lifestyle, public.lifestyle_importance,
              public.scenario_answers
  from anon, authenticated;

grant select on public.profiles, public.preferences, public.lifestyle, public.anchors to authenticated;

-- `(select public.uid())` is evaluated once per statement (Supabase RLS performance guidance).
create policy profiles_select_own    on public.profiles    for select to authenticated using (id = (select public.uid()));
create policy preferences_select_own on public.preferences for select to authenticated using (user_id = (select public.uid()));
create policy lifestyle_select_own   on public.lifestyle   for select to authenticated using (user_id = (select public.uid()));
create policy anchors_select_own     on public.anchors     for select to authenticated using (user_id = (select public.uid()));
