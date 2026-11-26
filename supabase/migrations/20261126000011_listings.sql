-- 0011 — Listings, rules, costs and media (T3.4; docs/04 §6.4, §8.2, §8.4; FR-LST-01..09).
-- (docs/04 §15 numbers this "0006"; the files took other numbers first, see §15.)
--
-- A listing is a room in a flat its owner lives in (FR-LST-01: `have_room` members only; no
-- landlords or brokers). Its exact pin and address stay private until both sides agree to share
-- (FR-LST-06): discovery reads `location_public`, a ~500 m grid point the database computes. Costs
-- carry the broker-free promise (brokerage must be 0). Media are 3–12 photos and one walkthrough
-- video recorded in the app (FR-LST-05); a listing can only go to review or live with all of that
-- and a DigiLocker-verified owner, which a deferred constraint trigger checks at commit, so the API
-- can write the parts in any order inside one transaction.
--
-- Clients never touch these tables: the API reads and writes them (docs/05 §8.6), so RLS is on and
-- nothing is granted to anon or authenticated.

create table public.listings (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.profiles(id) on delete cascade,
  status                 public.listing_status not null default 'draft',
  title                  text not null,
  description            text,
  area_id                smallint not null references ref.areas(id),
  location_exact         extensions.geography(Point, 4326) not null,  -- private until shared
  -- ~500 m grid point in UTM 43N (docs/04 §8.2); computed, so it can never be written directly
  location_public        extensions.geography(Point, 4326) not null generated always as (
    extensions.st_transform(extensions.st_snaptogrid(
      extensions.st_transform(location_exact::extensions.geometry, 32643), 500), 4326)::extensions.geography
  ) stored,
  address_enc            bytea,                                       -- AES-256-GCM in the API
  bhk                    smallint not null check (bhk between 1 and 6),
  room_type              public.room_type not null,
  furnishing             public.furnishing_level not null,
  available_from         date not null,
  min_lease_months       smallint not null default 11 check (min_lease_months between 1 and 36),
  total_flatmates        smallint not null check (total_flatmates between 2 and 10),
  current_flatmates      smallint not null check (current_flatmates between 1 and 9),
  rent_per_person_inr    integer not null check (rent_per_person_inr between 1000 and 200000),
  deposit_per_person_inr integer not null check (deposit_per_person_inr between 0 and 1000000),
  offers_video_tour      boolean not null default false,              -- v1.1 'remote-ready'
  review_notes           text,                                        -- moderators only (API)
  risk_score             smallint not null default 0 check (risk_score between 0 and 100),
  last_confirmed_at      timestamptz,
  expires_at             timestamptz,
  boost_until            timestamptz,
  published_at           timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint listings_flatmates_chk check (current_flatmates < total_flatmates),
  -- Delhi NCR (with margin): the 500 m grid above is only meaningful in UTM zone 43N
  constraint listings_location_ncr_chk check (
    extensions.st_x(location_exact::extensions.geometry) between 76.5 and 78.0
    and extensions.st_y(location_exact::extensions.geometry) between 27.8 and 29.2),
  constraint listings_title_chk check (char_length(title) between 5 and 80 and public.is_human_text(title)),
  constraint listings_description_chk check (
    description is null or (char_length(description) between 1 and 1000 and btrim(description) <> '')),
  constraint listings_review_notes_chk check (review_notes is null or char_length(review_notes) <= 2000),
  -- version(1) ‖ iv(12) ‖ ciphertext(≥1) ‖ tag(16), as private.identity_records.verified_name_enc
  constraint listings_address_enc_chk check (
    address_enc is null or (octet_length(address_enc) >= 1 + 12 + 1 + 16 and get_byte(address_enc, 0) = 1)),
  constraint listings_available_from_chk check (available_from between date '2026-01-01' and date '2100-01-01'),
  constraint listings_published_chk check (status not in ('active', 'paused', 'expired') or published_at is not null),
  constraint listings_expires_chk check (status <> 'active' or expires_at is not null)
);
create index listings_active_public_loc_idx on public.listings using gist (location_public)
  where status = 'active' and deleted_at is null;
create index listings_active_exact_loc_idx on public.listings using gist (location_exact)
  where status = 'active' and deleted_at is null;
create index listings_owner_idx   on public.listings (owner_id) where deleted_at is null;
create index listings_expires_idx on public.listings (expires_at) where status = 'active';
create index listings_area_idx    on public.listings (area_id) where status = 'active' and deleted_at is null;

create table public.listing_rules (
  listing_id        uuid primary key references public.listings(id) on delete cascade,
  bachelors_allowed boolean not null,
  food_rule         public.food_rule not null,
  guests_rule       public.guests_rule not null,
  pets_allowed      boolean not null,
  smoking_allowed   boolean not null,
  gender_rule       public.gender_preference not null
);

-- One-time costs: at most 10 items of { label: 1–40 visible characters, amount_inr: 0–1,000,000 },
-- and none of them a brokerage in disguise (FR-LST-03).
create or replace function public.valid_one_time_costs(costs jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(costs) = 'array'
     and jsonb_array_length(costs) <= 10
     and not exists (
       select 1 from jsonb_array_elements(costs) item
       where jsonb_typeof(item) <> 'object'
          or (select count(*) from jsonb_object_keys(item)) <> 2
          or jsonb_typeof(item -> 'label') <> 'string'
          or jsonb_typeof(item -> 'amount_inr') <> 'number'
          or char_length(item ->> 'label') not between 1 and 40
          or not public.is_human_text(item ->> 'label')
          or (item ->> 'label') ~* '(broker|dalal|commission|agent|finder)'
          or (item ->> 'amount_inr')::numeric <> trunc((item ->> 'amount_inr')::numeric)
          or (item ->> 'amount_inr')::numeric not between 0 and 1000000)
$$;
grant execute on function public.valid_one_time_costs(jsonb) to public;  -- a CHECK needs it

create table public.listing_costs (
  listing_id               uuid primary key references public.listings(id) on delete cascade,
  maintenance_inr          integer not null default 0 check (maintenance_inr between 0 and 100000),
  electricity_estimate_inr integer not null default 0 check (electricity_estimate_inr between 0 and 100000),
  wifi_inr                 integer not null default 0 check (wifi_inr between 0 and 100000),
  help_inr                 integer not null default 0 check (help_inr between 0 and 100000),   -- maid/cook share
  other_recurring_inr      integer not null default 0 check (other_recurring_inr between 0 and 100000),
  one_time_costs           jsonb not null default '[]',   -- [{ "label": "Setup", "amount_inr": 2000 }]
  brokerage_inr            integer not null default 0 check (brokerage_inr = 0),  -- broker-free, always
  recurring_costs_per_person_inr integer generated always as (
    maintenance_inr + electricity_estimate_inr + wifi_inr + help_inr + other_recurring_inr
  ) stored not null,                                     -- excludes rent (true monthly = rent + this)
  constraint listing_costs_one_time_chk check (public.valid_one_time_costs(one_time_costs))
);

create table public.listing_media (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings(id) on delete cascade,
  kind              public.media_kind not null,
  storage_bucket    text not null,
  storage_key       text not null,
  sha256            bytea not null,
  phash             bit(64),
  duration_s        smallint,
  width             integer check (width is null or width between 1 and 10000),
  height            integer check (height is null or height between 1 and 10000),
  recorded_in_app   boolean not null default false,
  integrity_verdict text,                                -- Play Integrity verdict, never the token
  captured_at       timestamptz,
  position          smallint not null default 0,
  moderation_status public.moderation_status not null default 'pending',
  created_at        timestamptz not null default now(),
  constraint listing_media_bucket_chk check (
    (kind = 'photo' and storage_bucket = 'listing-photos')
    or (kind = 'walkthrough_video' and storage_bucket = 'r2-walkthroughs')),
  -- <listing_id>/<uuid>.webp (photos) or .mp4 (videos): files sit under their own listing
  constraint listing_media_key_chk check (
    storage_key = listing_id::text || '/' || substring(storage_key from '[^/]+$')
    and storage_key ~ ('^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'
      || case kind when 'photo' then 'webp' else 'mp4' end || '$')),
  constraint listing_media_sha256_chk check (octet_length(sha256) = 32),
  constraint listing_media_video_duration_chk check (
    (kind = 'walkthrough_video') = (duration_s is not null)
    and (duration_s is null or duration_s between 30 and 90)),
  -- FR-LST-05: recorded in the app, with the capture time and a Play Integrity verdict
  constraint listing_media_video_in_app_chk check (
    kind <> 'walkthrough_video' or (recorded_in_app and captured_at is not null and integrity_verdict is not null)),
  constraint listing_media_integrity_chk check (
    integrity_verdict is null
    or integrity_verdict in ('unverified', 'meets_device_integrity', 'meets_basic_integrity', 'failed')),
  constraint listing_media_position_chk check (
    (kind = 'photo' and position between 0 and 11) or (kind = 'walkthrough_video' and position = 0))
);
-- With the position check above this caps a listing at 12 photos and one video (moves included);
-- replacing a file at a position is an upsert on this key.
create unique index listing_media_position_key on public.listing_media (listing_id, kind, position);
create unique index listing_media_key_key on public.listing_media (storage_bucket, storage_key);
create index listing_media_phash_idx on public.listing_media (phash) where phash is not null;
create index listing_media_sha_idx on public.listing_media (sha256);

create trigger listings_set_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- FR-LST-01: only members looking for flatmates for their own room list one.
create or replace function public.listing_owner_has_room() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.owner_id and p.intent = 'have_room') then
    raise exception 'listing_owner_not_have_room' using errcode = '23514',
      detail = 'Only have_room members can create listings (FR-LST-01)';
  end if;
  return new;
end $$;
revoke execute on function public.listing_owner_has_room() from public, anon, authenticated;
create trigger listings_owner_has_room before insert or update of owner_id on public.listings
  for each row execute function public.listing_owner_has_room();

-- A listing in review or live is complete (docs/04 §8.4, FR-LST-02..05, docs/05 §8.6 submit):
-- rules, costs, 3–12 photos and exactly one in-app walkthrough video (rejected media do not count).
-- Checked at commit (deferred), so the API can write the parts in any order in one transaction:
--   * when a listing enters pending_review or active (also from paused/expired), together with a
--     DigiLocker-verified owner who still has a room;
--   * when a part is removed, moved or rejected while the listing is in review or live.
-- Other updates (expiry, moderation fields, a confirm) are not blocked by these checks; an owner
-- who stops qualifying has their listings taken down by listing_owner_changed below.
create or replace function public.assert_listing_complete(lid uuid, check_owner boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  photos int;
  videos int;
begin
  select * into l from public.listings where id = lid;
  if not found or l.status not in ('pending_review', 'active') or l.deleted_at is not null then
    return;
  end if;
  if not exists (select 1 from public.listing_rules r where r.listing_id = lid) then
    raise exception 'listing_incomplete' using errcode = '23514', detail = 'rules';
  end if;
  if not exists (select 1 from public.listing_costs c where c.listing_id = lid) then
    raise exception 'listing_incomplete' using errcode = '23514', detail = 'costs';
  end if;
  select count(*) filter (where kind = 'photo' and moderation_status <> 'rejected'),
         count(*) filter (where kind = 'walkthrough_video' and moderation_status <> 'rejected')
    into photos, videos
    from public.listing_media m where m.listing_id = lid;
  if photos < 3 then
    raise exception 'listing_incomplete' using errcode = '23514', detail = 'photos';
  end if;
  if videos <> 1 then
    raise exception 'listing_incomplete' using errcode = '23514', detail = 'video';
  end if;
  if check_owner and not exists (select 1 from public.profiles p
                 where p.id = l.owner_id and p.is_identity_verified and p.intent = 'have_room') then
    raise exception 'listing_incomplete' using errcode = '23514', detail = 'owner';
  end if;
end $$;
revoke execute on function public.assert_listing_complete(uuid, boolean) from public, anon, authenticated;

create or replace function public.check_listing_complete() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'listings' then
    if tg_op = 'INSERT' or new.status is distinct from old.status or new.owner_id is distinct from old.owner_id
       or new.deleted_at is distinct from old.deleted_at then
      perform public.assert_listing_complete(new.id, true);
    end if;
  else
    -- a part was removed, moved or (media) rejected: the listing(s) it left must still be complete
    perform public.assert_listing_complete(old.listing_id, false);
    if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
      perform public.assert_listing_complete(new.listing_id, false);
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.check_listing_complete() from public, anon, authenticated;
create constraint trigger listings_complete
  after insert or update on public.listings
  deferrable initially deferred
  for each row execute function public.check_listing_complete();
create constraint trigger listing_rules_complete
  after delete or update of listing_id on public.listing_rules
  deferrable initially deferred
  for each row execute function public.check_listing_complete();
create constraint trigger listing_costs_complete
  after delete or update of listing_id on public.listing_costs
  deferrable initially deferred
  for each row execute function public.check_listing_complete();
create constraint trigger listing_media_complete
  after delete or update of moderation_status, listing_id, kind on public.listing_media
  deferrable initially deferred
  for each row execute function public.check_listing_complete();

-- An owner who no longer has a room, or is no longer DigiLocker-verified, cannot keep a listing in
-- discovery: live listings are paused and listings in review go back to draft.
create or replace function public.listing_owner_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.intent <> 'have_room' or not new.is_identity_verified then
    update public.listings set status = case status when 'active' then 'paused'::public.listing_status
                                                    else 'draft'::public.listing_status end
      where owner_id = new.id and status in ('active', 'pending_review') and deleted_at is null;
  end if;
  return null;
end $$;
revoke execute on function public.listing_owner_changed() from public, anon, authenticated;
create trigger profiles_listing_owner_changed after update of intent, is_identity_verified on public.profiles
  for each row execute function public.listing_owner_changed();

-- API only (docs/04 §5): RLS on, nothing for clients.
alter table public.listings      enable row level security;
alter table public.listing_rules enable row level security;
alter table public.listing_costs enable row level security;
alter table public.listing_media enable row level security;
revoke all on public.listings, public.listing_rules, public.listing_costs, public.listing_media
  from anon, authenticated;

comment on column public.listings.location_exact is 'Private: never returned until both sides agree to share the address (FR-LST-06).';
comment on column public.listings.location_public is '~500 m grid point computed from location_exact (docs/04 §8.2); what discovery shows.';
comment on column public.listings.address_enc is 'Full address, AES-256-GCM with FIELD_ENCRYPTION_KEY (bound to the listing id).';
comment on column public.listing_costs.brokerage_inr is 'Always 0: Flatrimony is broker-free (FR-LST-03).';
