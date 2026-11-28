-- 0016 — Discovery, swipes and matches (T4.2; docs/04 §6.5, §7, §15.11; FR-DISC-06, 08, 09).
--
-- The tables of docs/04 §6.5 ("0007" in its plan), with database checks the design implies:
--   * a room swipe (listing_id set) targets that listing's owner;
--   * a room match is between the listing's owner and the other member, in canonical order;
--   * a closed match has its reason and time; an open one has neither;
--   * only the match's two members can decide on it or share contacts in it;
--   * notes (super likes) are visible text of at most 140 characters.
--
-- Clients read only their own matches, their own "still interested?" answers and the contact shares
-- of their matches (docs/04 §7: never the other member's answer). Swipes, the deck cache and blocks
-- are API-only. Writes always go through the API.

create table public.swipes (
  id            uuid primary key default gen_random_uuid(),
  swiper_id     uuid not null references public.profiles(id) on delete cascade,
  target_id     uuid not null references public.profiles(id) on delete cascade,
  -- A room card: one swipe per room (FR-DISC-06). Null: a person card.
  listing_id    uuid references public.listings(id) on delete cascade,
  action        public.swipe_action not null,
  -- A super like's note (Move Pass).
  note          text,
  created_at    timestamptz not null default now(),
  -- Re-swiping a passed card after 30 days (FR-DISC-09) updates this row, not a new one.
  constraint swipes_target_key unique nulls not distinct (swiper_id, target_id, listing_id),
  constraint swipes_not_self_chk check (swiper_id <> target_id),
  constraint swipes_note_chk check (note is null or action = 'super_like'),
  constraint swipes_note_text_chk check (
    note is null or (char_length(note) between 1 and 140 and public.is_display_text(note)))
);
-- Likes received (Move Pass, "who liked you").
create index swipes_target_like_idx on public.swipes (target_id, created_at desc)
  where action in ('like', 'super_like');
-- Today's likes of a member (the daily limit, FR-DISC-08).
create index swipes_swiper_created_idx on public.swipes (swiper_id, created_at desc);
create index swipes_listing_idx on public.swipes (listing_id) where listing_id is not null;

create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  listing_id      uuid references public.listings(id) on delete set null,
  score           smallint not null check (score between 0 and 100),
  -- The Rishta report at match time: { "agreements": [...], "biggestGap": {...}, "perAttribute": {...} }
  breakdown       jsonb not null,
  status          public.match_status not null default 'matched',
  closed_reason   public.match_close_reason,
  closed_by       uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  constraint matches_order_chk check (user_a < user_b),  -- canonical order: one row per pair
  constraint matches_closed_chk check ((status = 'closed') = (closed_at is not null)),
  constraint matches_closed_reason_chk check ((status = 'closed') = (closed_reason is not null)),
  constraint matches_closed_after_chk check (closed_at is null or closed_at >= created_at),
  constraint matches_breakdown_chk check (jsonb_typeof(breakdown) = 'object'),
  -- One match per room, or per person pair.
  constraint matches_pair_listing_key unique nulls not distinct (user_a, user_b, listing_id)
);
create index matches_user_a_idx on public.matches (user_a, status, last_message_at desc nulls last);
create index matches_user_b_idx on public.matches (user_b, status, last_message_at desc nulls last);
create index matches_listing_idx on public.matches (listing_id) where listing_id is not null;

create table public.match_decisions (
  match_id          uuid not null references public.matches(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  still_interested  boolean not null,
  decided_at        timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.contact_shares (
  match_id   uuid not null references public.matches(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  shared_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.deck_cache (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  mode         text not null check (mode in ('people', 'rooms')),
  -- Ordered [{ "targetId": ..., "listingId": ..., "score": .. }]
  items        jsonb not null check (jsonb_typeof(items) = 'array'),
  computed_at  timestamptz not null default now(),
  -- A hash of the preferences and filters used: a change makes the cache stale.
  params_hash  text not null check (char_length(params_hash) between 1 and 128)
);

create table public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self_chk check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Consistency triggers
-- ---------------------------------------------------------------------------

-- A room swipe targets the room's owner.
create or replace function private.check_swipe_listing() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.listing_id is not null and not exists (
    select 1 from public.listings l where l.id = new.listing_id and l.owner_id = new.target_id) then
    raise exception 'swipe_listing_owner' using errcode = '23514',
      detail = 'A room swipe must target the owner of that listing';
  end if;
  return new;
end $$;
revoke execute on function private.check_swipe_listing() from public, anon, authenticated;

create trigger swipes_listing_owner
  before insert or update of listing_id, target_id on public.swipes
  for each row execute function private.check_swipe_listing();

-- A room match is between the room's owner and the other member (checked when the match is made;
-- a deleted listing later leaves listing_id null).
create or replace function private.check_match_listing() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.listing_id is not null and not exists (
    select 1 from public.listings l
     where l.id = new.listing_id and l.owner_id in (new.user_a, new.user_b)) then
    raise exception 'match_listing_owner' using errcode = '23514',
      detail = 'A room match must include the owner of that listing';
  end if;
  return new;
end $$;
revoke execute on function private.check_match_listing() from public, anon, authenticated;

create trigger matches_listing_owner
  before insert or update of listing_id, user_a, user_b on public.matches
  for each row execute function private.check_match_listing();

-- Only the two members of a match decide on it or share contacts in it.
create or replace function private.check_match_member() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.matches m where m.id = new.match_id and new.user_id in (m.user_a, m.user_b)) then
    raise exception 'not_match_member' using errcode = '23514',
      detail = 'Only the two members of a match can act on it';
  end if;
  return new;
end $$;
revoke execute on function private.check_match_member() from public, anon, authenticated;

create trigger match_decisions_member
  before insert or update of match_id, user_id on public.match_decisions
  for each row execute function private.check_match_member();
create trigger contact_shares_member
  before insert or update of match_id, user_id on public.contact_shares
  for each row execute function private.check_match_member();

-- ---------------------------------------------------------------------------
-- Access (docs/04 §7): members read their matches, their own answers and their matches' contact
-- shares; nothing else reaches a client. All writes go through the API.
-- ---------------------------------------------------------------------------
create or replace function public.is_match_member(m public.matches) returns boolean
language sql stable
set search_path = ''
as $$ select public.uid() in (m.user_a, m.user_b) $$;
revoke execute on function public.is_match_member(public.matches) from public, anon;
grant execute on function public.is_match_member(public.matches) to authenticated;

alter table public.swipes          enable row level security;
alter table public.matches         enable row level security;
alter table public.match_decisions enable row level security;
alter table public.contact_shares  enable row level security;
alter table public.deck_cache      enable row level security;
alter table public.blocks          enable row level security;

revoke all on public.swipes, public.matches, public.match_decisions, public.contact_shares,
              public.deck_cache, public.blocks from anon, authenticated;
grant select on public.matches, public.match_decisions, public.contact_shares to authenticated;

create policy matches_select_member on public.matches for select to authenticated
  using (public.uid() in (user_a, user_b));

-- Never the other member's answer (docs/04 §7).
create policy decisions_select_own on public.match_decisions for select to authenticated
  using (user_id = public.uid());

create policy contact_shares_select_member on public.contact_shares for select to authenticated
  using (exists (
    select 1 from public.matches m
     where m.id = contact_shares.match_id and public.uid() in (m.user_a, m.user_b)));

-- Realtime (docs/04 §7): match changes and the member's own decisions reach the app live. The
-- publication exists wherever Supabase Realtime is installed.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.matches, public.match_decisions;
  end if;
end $$;
