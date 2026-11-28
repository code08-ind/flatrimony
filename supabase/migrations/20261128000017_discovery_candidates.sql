-- 0017 — Discovery candidates (T4.3; docs/04 §10; FR-DISC-02, FR-DISC-09, FR-DISC-12, FR-SAFE-04).
--
-- Two functions return the cards a member may be shown, before scoring: at most `max_rows`
-- (≤ 300), most recently active first. The API scores and ranks them with packages/matching and
-- runs the women-only response filter again (docs/03 §13: "tested both ways").
--
--   private.discovery_rooms(viewer, max_rows)   live rooms for a member looking for one
--   private.discovery_people(viewer, max_rows)  members to team up with (need_room / pair_up)
--
-- Hard filters (FR-DISC-02), as docs/04 §10 sketches them:
--   * nobody deleted, paused or suspended; never the viewer; nobody blocked either way;
--   * not swiped already (a pass comes back after 30 days, FR-DISC-09; a like never does);
--   * budget: the room's rent within the viewer's range (rooms), or the two ranges overlap (people);
--   * move-in: within 30 days of the viewer's window;
--   * commute: inside the viewer's commute zone (rooms) or the two zones meet (people); without a
--     zone yet, a shared preferred area instead;
--   * the room's rules vs the viewer's habits (food, smoking, pets, guests);
--   * gender rules both ways (a room's rule; each member's flatmate preference), on DigiLocker-
--     verified genders only. An unverified viewer still sees a female_only or male_only room, locked
--     (FR-DISC-12: "Verify to like this room");
--   * women-only (FR-SAFE-04, founder rule): a women_only member's profile and rooms only ever reach a
--     viewer whose gender DigiLocker verified as female. Never relaxed for unverified viewers.
-- Deal-breakers are checked by packages/matching on these candidates (self-ratings, the same rule
-- everywhere). The "bachelors allowed: no" room rule is not applied yet (founder decision, docs/07
-- T4.3): nearly every member is a bachelor, so it would hide the room from almost everyone.

create or replace function private.discovery_rooms(viewer uuid, max_rows integer default 300)
returns table (listing_id uuid, target_id uuid, is_locked boolean)
language sql stable
security definer
set search_path = ''
as $$
  with v as (
    select p.id, p.is_identity_verified,
           case when p.is_identity_verified then p.verified_gender end as gender,
           pr.budget_min_inr, pr.budget_max_inr, pr.move_in_from, pr.move_in_to,
           pr.flatmate_gender_pref, l.food, l.smoking, l.pets, l.guests, cz.zone
      from public.profiles p
      join public.preferences pr on pr.user_id = p.id
      join public.lifestyle l on l.user_id = p.id
      left join public.commute_zones cz on cz.user_id = p.id
     where p.id = viewer and p.deleted_at is null
  )
  select lst.id, lst.owner_id,
         (not v.is_identity_verified and r.gender_rule <> 'any') as is_locked
    from v
    join public.listings lst on lst.status = 'active' and lst.deleted_at is null
    join public.listing_rules r on r.listing_id = lst.id
    join public.profiles o on o.id = lst.owner_id
   where o.id <> v.id
     and o.deleted_at is null and not o.is_paused
     and (o.suspended_until is null or o.suspended_until <= now())
     -- budget: the room's rent in the viewer's range (the card shows the true monthly cost)
     and lst.rent_per_person_inr between v.budget_min_inr and v.budget_max_inr
     -- move-in: within 30 days of the viewer's window
     and lst.available_from between v.move_in_from - 30 and v.move_in_to + 30
     -- commute zone, or a preferred area until the zone is computed
     and (
       (v.zone is not null and extensions.st_intersects(lst.location_exact, v.zone))
       or (v.zone is null and exists (
             select 1 from public.preference_areas pa
              where pa.user_id = v.id and pa.area_id = lst.area_id))
     )
     -- the room's rules vs the viewer's habits
     and (r.food_rule = 'any'
          or (r.food_rule = 'veg_only' and v.food in ('veg', 'vegan'))
          or (r.food_rule = 'eggetarian_ok' and v.food in ('veg', 'vegan', 'eggetarian')))
     and (r.smoking_allowed or v.smoking = 'no')
     and (r.pets_allowed or v.pets <> 'have')
     and (r.guests_rule <> 'not_allowed' or v.guests is null or v.guests in ('never', 'rarely'))
     -- the room's gender rule: verified viewers must fit; unverified ones see it locked
     and (r.gender_rule = 'any'
          or not v.is_identity_verified
          or (r.gender_rule = 'female_only' and v.gender = 'female')
          or (r.gender_rule = 'male_only' and v.gender = 'male'))
     -- the viewer's flatmate preference vs the owner (owners of live rooms are verified)
     and (v.flatmate_gender_pref = 'any'
          or (v.flatmate_gender_pref = 'female_only' and o.is_identity_verified and o.verified_gender = 'female')
          or (v.flatmate_gender_pref = 'male_only' and o.is_identity_verified and o.verified_gender = 'male'))
     -- women-only (FR-SAFE-04): only DigiLocker-verified women, never anyone else
     and (o.category <> 'women_only' or v.gender = 'female')
     -- this room not swiped (a pass returns after 30 days)
     and not exists (
       select 1 from public.swipes s
        where s.swiper_id = v.id and s.listing_id = lst.id
          and (s.action <> 'pass' or s.created_at > now() - interval '30 days'))
     -- no block either way
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = v.id and b.blocked_id = o.id)
           or (b.blocker_id = o.id and b.blocked_id = v.id))
   order by o.last_active_at desc, lst.id
   limit least(greatest(coalesce(max_rows, 300), 0), 300)
$$;

create or replace function private.discovery_people(viewer uuid, max_rows integer default 300)
returns table (target_id uuid)
language sql stable
security definer
set search_path = ''
as $$
  with v as (
    select p.id, p.intent,
           case when p.is_identity_verified then p.verified_gender end as gender,
           pr.budget_min_inr, pr.budget_max_inr, pr.move_in_from, pr.move_in_to,
           pr.flatmate_gender_pref, cz.zone
      from public.profiles p
      join public.preferences pr on pr.user_id = p.id
      join public.lifestyle l on l.user_id = p.id
      left join public.commute_zones cz on cz.user_id = p.id
     where p.id = viewer and p.deleted_at is null
  )
  select o.id
    from v
    join public.profiles o on o.id <> v.id
    join public.preferences opr on opr.user_id = o.id
    join public.lifestyle ol on ol.user_id = o.id
    left join public.commute_zones ocz on ocz.user_id = o.id
   where o.intent in ('need_room', 'pair_up')
     and o.deleted_at is null and not o.is_paused
     and (o.suspended_until is null or o.suspended_until <= now())
     -- budgets overlap
     and int4range(v.budget_min_inr, v.budget_max_inr, '[]')
         && int4range(opr.budget_min_inr, opr.budget_max_inr, '[]')
     -- move-in windows within 30 days of each other
     and daterange(v.move_in_from - 30, v.move_in_to + 30, '[]')
         && daterange(opr.move_in_from, opr.move_in_to, '[]')
     -- commute zones meet; without both zones, a shared preferred area
     and (
       (v.zone is not null and ocz.zone is not null and extensions.st_intersects(v.zone, ocz.zone))
       or ((v.zone is null or ocz.zone is null) and exists (
             select 1 from public.preference_areas a
               join public.preference_areas b on b.area_id = a.area_id
              where a.user_id = v.id and b.user_id = o.id))
     )
     -- flatmate preferences both ways, on DigiLocker-verified genders only
     and (v.flatmate_gender_pref = 'any'
          or (v.flatmate_gender_pref = 'female_only' and o.is_identity_verified and o.verified_gender = 'female')
          or (v.flatmate_gender_pref = 'male_only' and o.is_identity_verified and o.verified_gender = 'male'))
     and (opr.flatmate_gender_pref = 'any'
          or (opr.flatmate_gender_pref = 'female_only' and v.gender = 'female')
          or (opr.flatmate_gender_pref = 'male_only' and v.gender = 'male'))
     -- women-only (FR-SAFE-04): only DigiLocker-verified women, never anyone else
     and (o.category <> 'women_only' or v.gender = 'female')
     -- this person not swiped (a pass returns after 30 days)
     and not exists (
       select 1 from public.swipes s
        where s.swiper_id = v.id and s.target_id = o.id and s.listing_id is null
          and (s.action <> 'pass' or s.created_at > now() - interval '30 days'))
     -- no block either way
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = v.id and b.blocked_id = o.id)
           or (b.blocker_id = o.id and b.blocked_id = v.id))
   order by o.last_active_at desc, o.id
   limit least(greatest(coalesce(max_rows, 300), 0), 300)
$$;

revoke execute on function private.discovery_rooms(uuid, integer) from public, anon, authenticated;
revoke execute on function private.discovery_people(uuid, integer) from public, anon, authenticated;

-- docs/04 §9: the filters' supporting indexes.
create index if not exists preferences_budget_idx on public.preferences (budget_min_inr, budget_max_inr);
create index if not exists preferences_move_in_idx on public.preferences (move_in_from, move_in_to);
create index if not exists profiles_discoverable_idx on public.profiles (category, intent, last_active_at desc)
  where deleted_at is null and is_paused = false;
