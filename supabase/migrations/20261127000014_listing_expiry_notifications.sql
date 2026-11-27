-- 0014 — Listing expiry and reminders (T3.10; FR-LST-07; docs/04 §11, §15.9).
--
-- A live listing stays in discovery for 7 days after its owner last confirmed it is still
-- available. The worker's 5-minute tick reminds the owner during the last day ("Is your room still
-- available?") and expires listings whose time is up. The reminder is an in-app notification row
-- (public.notifications, pulled forward from the 0011 plan; docs/04 §6.10): push delivery needs the
-- Expo/FCM project (Blocked) and arrives with the notifications work, reading the same rows.

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,                      -- 'listing.expiring', 'listing.expired', …
  title_key   text not null,                      -- i18n key
  params      jsonb not null default '{}',        -- non-sensitive params (ids, counts), never PII
  deep_link   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint notifications_type_chk check (type ~ '^[a-z]+(\.[a-z_]+)+$' and char_length(type) <= 64),
  constraint notifications_title_key_chk check (title_key ~ '^[a-zA-Z]+(\.[a-zA-Z]+)+$' and char_length(title_key) <= 128),
  constraint notifications_params_chk check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 2000),
  -- In-app links or the app's https universal links (docs/05 §10); no spaces or quotes.
  constraint notifications_deep_link_chk check (
    deep_link is null or (deep_link ~ '^(flatrimony://|https://)[A-Za-z0-9/_.?=&%#-]+$' and char_length(deep_link) <= 300))
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- API and worker only (docs/04 §5): RLS on, nothing granted to clients.
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- The expiry the owner was last reminded of. A reminder is due when this is not the listing's
-- current expires_at: a confirmation (or going live again) sets a new expires_at, so the next
-- reminder is due again, whichever transaction's clock ran first.
alter table public.listings add column expiry_reminded_for timestamptz;

-- A listing entering `active` (submit, resume, confirm, a moderator's approval) whose 7 days are
-- over or unset gets a fresh 7 days, so it never expires the minute it goes live (a listing held
-- for review keeps its old expires_at while it waits).
create or replace function public.listing_fresh_week() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active'
     and (new.expires_at is null or new.expires_at <= now()) then
    new.expires_at := now() + interval '7 days';
    new.last_confirmed_at := now();
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
revoke execute on function public.listing_fresh_week() from public, anon, authenticated;
create trigger listings_fresh_week before update of status on public.listings
  for each row execute function public.listing_fresh_week();

-- The tick finds what is about to expire, and what has, through listings_expires_idx (0011).

comment on table public.notifications is 'In-app notifications (docs/04 §6.10); push delivery reads the same rows later. Params never hold personal data.';
comment on column public.listings.expiry_reminded_for is 'The expires_at the last "still available?" reminder was for (FR-LST-07); one reminder per week.';
