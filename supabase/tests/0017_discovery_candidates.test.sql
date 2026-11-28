-- pgTAP: discovery candidates (T4.3, migration 0017). Proves the hard filters, and that a viewer
-- who is not a DigiLocker-verified woman never receives a women_only owner or profile from either
-- mode (docs/04 §10 test requirement; FR-SAFE-04).
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- A member with preferences and habits, all in one area by default.
create function pg_temp.member(
  id uuid, name text, intent public.user_intent, category public.user_category default 'professional',
  gender public.verified_gender default null, area smallint default null,
  budget int4range default '[10000,25000]', pref public.gender_preference default 'any',
  food public.food_habit default 'veg', smoking public.smoking_habit default 'no',
  pets public.pet_attitude default 'love', guests public.frequency_level default 'rarely'
) returns void language plpgsql as $$
begin
  insert into auth.users (id, aud, role, phone)
    values (id, 'authenticated', 'authenticated', '9196' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0'));
  -- Verified gender without an identity record: the deferred consistency check runs at commit, and
  -- this test rolls back.
  insert into public.profiles (id, display_name, intent, category, is_identity_verified, verified_gender)
    values (id, name, intent, category, gender is not null, gender);
  insert into public.preferences (user_id, budget_min_inr, budget_max_inr, move_in_from, move_in_to, flatmate_gender_pref)
    values (id, lower(budget), upper(budget) - 1, '2026-12-01', '2026-12-31', pref);
  insert into public.lifestyle (user_id, bedtime, wake_time, cleaning, smoking, pets, food, guests)
    values (id, '23:00', '07:00', 'daily', smoking, pets, food, guests);
  insert into public.preference_areas (user_id, area_id)
    values (id, coalesce(area, (select min(a.id) from ref.areas a)));
end $$;

-- A live room (the completeness check is deferred to commit; this test rolls back).
create function pg_temp.room(
  id uuid, owner uuid, rent int default 18000, available date default '2026-12-15',
  area smallint default null, food public.food_rule default 'any',
  gender public.gender_preference default 'any', smoking boolean default true,
  pets boolean default true, guests public.guests_rule default 'allowed',
  status public.listing_status default 'active'
) returns void language plpgsql as $$
begin
  insert into public.listings (id, owner_id, status, title, area_id, location_exact, bhk, room_type, furnishing,
      available_from, total_flatmates, current_flatmates, rent_per_person_inr, deposit_per_person_inr)
    values (id, owner, 'draft', 'Room ' || left(id::text, 4), coalesce(area, (select min(a.id) from ref.areas a)),
      extensions.st_point(77.0891, 28.4951)::extensions.geography, 3, 'private', 'semi_furnished',
      available, 3, 2, rent, rent * 2);
  insert into public.listing_rules (listing_id, bachelors_allowed, food_rule, guests_rule, pets_allowed,
      smoking_allowed, gender_rule)
    values (id, true, food, guests, pets, smoking, gender);
  -- Going live sets its week (listings_fresh_week).
  if status <> 'draft' then
    update public.listings l set status = room.status where l.id = room.id;
  end if;
end $$;

create function pg_temp.rooms(viewer uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(listing_id order by listing_id), '{}') from private.discovery_rooms(viewer) $$;
create function pg_temp.people(viewer uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(target_id order by target_id), '{}') from private.discovery_people(viewer) $$;

-- Viewers: a verified woman, a verified man (non-veg smoker with a pet who has guests often), an
-- unverified member.
select pg_temp.member('00000000-0000-4000-8000-0000000017f1', 'Asha', 'need_room', gender => 'female');
select pg_temp.member('00000000-0000-4000-8000-0000000017a1', 'Rahul', 'need_room', gender => 'male',
  food => 'non_veg', smoking => 'yes', pets => 'have', guests => 'often');
select pg_temp.member('00000000-0000-4000-8000-0000000017c1', 'Sam', 'need_room');
-- Owners: a verified woman, and a verified woman in the women-only category.
select pg_temp.member('00000000-0000-4000-8000-0000000017e1', 'Meera', 'have_room', gender => 'female');
select pg_temp.member('00000000-0000-4000-8000-0000000017e2', 'Neha', 'have_room', 'women_only', gender => 'female');

select pg_temp.room('00000000-0000-4000-8000-00000000170a', '00000000-0000-4000-8000-0000000017e1');                       -- base
select pg_temp.room('00000000-0000-4000-8000-00000000170b', '00000000-0000-4000-8000-0000000017e1', rent => 30000);      -- over budget
select pg_temp.room('00000000-0000-4000-8000-00000000170c', '00000000-0000-4000-8000-0000000017e1', available => '2027-03-01'); -- too late
select pg_temp.room('00000000-0000-4000-8000-00000000170d', '00000000-0000-4000-8000-0000000017e1',
  area => (select max(a.id) from ref.areas a));                                                                          -- other area
select pg_temp.room('00000000-0000-4000-8000-00000000170e', '00000000-0000-4000-8000-0000000017e1', food => 'veg_only',
  smoking => false, pets => false, guests => 'not_allowed');                                                             -- strict rules
select pg_temp.room('00000000-0000-4000-8000-00000000170f', '00000000-0000-4000-8000-0000000017e1', gender => 'female_only');
select pg_temp.room('00000000-0000-4000-8000-000000001710', '00000000-0000-4000-8000-0000000017e1', gender => 'male_only');
select pg_temp.room('00000000-0000-4000-8000-000000001711', '00000000-0000-4000-8000-0000000017e1', status => 'draft');
select pg_temp.room('00000000-0000-4000-8000-000000001712', '00000000-0000-4000-8000-0000000017e2');                       -- women-only owner

-- Rooms ------------------------------------------------------------------------------------------
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'),
  array['00000000-0000-4000-8000-00000000170a', '00000000-0000-4000-8000-00000000170e',
        '00000000-0000-4000-8000-00000000170f', '00000000-0000-4000-8000-000000001712']::uuid[],
  '1. a verified woman: the base room, the strict room (her habits fit), the female_only room and the women-only owner''s room');
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017a1'),
  array['00000000-0000-4000-8000-00000000170a', '00000000-0000-4000-8000-000000001710']::uuid[],
  '2. a verified man: no strict-rule room, no female_only room, never the women-only owner''s');
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017c1'),
  array['00000000-0000-4000-8000-00000000170a', '00000000-0000-4000-8000-00000000170e',
        '00000000-0000-4000-8000-00000000170f', '00000000-0000-4000-8000-000000001710']::uuid[],
  '3. unverified: gendered rooms (locked), never the women-only owner''s');
select is((select array_agg(is_locked order by listing_id) from private.discovery_rooms('00000000-0000-4000-8000-0000000017c1')),
  array[false, false, true, true], '4. gendered rooms are locked for the unverified viewer (FR-DISC-12)');
select ok(not ('00000000-0000-4000-8000-00000000170b' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '5. over budget is out');
select ok(not ('00000000-0000-4000-8000-00000000170c' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '6. available too late is out');
select ok(not ('00000000-0000-4000-8000-00000000170d' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '7. outside the preferred areas (no commute zone yet) is out');
select ok(not ('00000000-0000-4000-8000-000000001711' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '8. drafts are never shown');
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017e1'), array['00000000-0000-4000-8000-000000001712']::uuid[],
  '9. nobody sees their own rooms (this owner, a verified woman, sees only the other owner''s)');

-- A commute zone replaces the areas: the base room's point is inside a 5 km zone around it.
insert into public.commute_zones (user_id, travel_mode, max_minutes, zone)
  values ('00000000-0000-4000-8000-0000000017f1', 'metro_transit', 45,
    extensions.st_multi(extensions.st_buffer(extensions.st_point(77.0891, 28.4951)::extensions.geography, 5000)::extensions.geometry)::extensions.geography);
select ok('00000000-0000-4000-8000-00000000170d' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1')),
  '10. with a commute zone, the room inside it counts even in another area');
delete from public.commute_zones where user_id = '00000000-0000-4000-8000-0000000017f1';
insert into public.commute_zones (user_id, travel_mode, max_minutes, zone)
  values ('00000000-0000-4000-8000-0000000017f1', 'metro_transit', 45,
    extensions.st_multi(extensions.st_buffer(extensions.st_point(77.3, 28.6)::extensions.geography, 2000)::extensions.geometry)::extensions.geography);
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'), '{}'::uuid[], '11. rooms outside the commute zone are out');
delete from public.commute_zones where user_id = '00000000-0000-4000-8000-0000000017f1';

-- Swipes: a like hides the room; a pass hides it for 30 days.
insert into public.swipes (swiper_id, target_id, listing_id, action)
  values ('00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017e1', '00000000-0000-4000-8000-00000000170a', 'like');
select ok(not ('00000000-0000-4000-8000-00000000170a' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '12. a liked room is not shown again');
update public.swipes set action = 'pass', created_at = now() - interval '29 days'
 where swiper_id = '00000000-0000-4000-8000-0000000017f1' and listing_id = '00000000-0000-4000-8000-00000000170a';
select ok(not ('00000000-0000-4000-8000-00000000170a' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '13. a passed room stays hidden for 30 days');
update public.swipes set created_at = now() - interval '31 days'
 where swiper_id = '00000000-0000-4000-8000-0000000017f1' and listing_id = '00000000-0000-4000-8000-00000000170a';
select ok('00000000-0000-4000-8000-00000000170a' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1')),
  '14. after 30 days a passed room comes back (FR-DISC-09)');
select ok('00000000-0000-4000-8000-00000000170e' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1')),
  '15. swipes are per room: the owner''s other rooms stay');

-- Blocks either way, paused and suspended owners.
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-0000000017e1', '00000000-0000-4000-8000-0000000017f1');
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'), array['00000000-0000-4000-8000-000000001712']::uuid[],
  '16. an owner who blocked the viewer disappears with all their rooms');
delete from public.blocks;
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017e2');
select ok(not ('00000000-0000-4000-8000-000000001712' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '17. so does an owner the viewer blocked');
delete from public.blocks;
update public.profiles set is_paused = true where id = '00000000-0000-4000-8000-0000000017e2';
select ok(not ('00000000-0000-4000-8000-000000001712' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '18. a paused owner''s rooms are not shown');
update public.profiles set is_paused = false, suspended_until = now() + interval '1 day'
 where id = '00000000-0000-4000-8000-0000000017e2';
select ok(not ('00000000-0000-4000-8000-000000001712' = any(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'))),
  '19. nor a suspended owner''s');
update public.profiles set suspended_until = null where id = '00000000-0000-4000-8000-0000000017e2';

-- The viewer's flatmate preference vs the owner.
update public.preferences set flatmate_gender_pref = 'male_only' where user_id = '00000000-0000-4000-8000-0000000017f1';
select is(pg_temp.rooms('00000000-0000-4000-8000-0000000017f1'), '{}'::uuid[],
  '20. a viewer who wants male flatmates does not see rooms of women owners');
update public.preferences set flatmate_gender_pref = 'any' where user_id = '00000000-0000-4000-8000-0000000017f1';
select is((select count(*)::int from private.discovery_rooms('00000000-0000-4000-8000-0000000017f1', 2)), 2,
  '21. the limit is honoured');

-- People --------------------------------------------------------------------------------------------
select pg_temp.member('00000000-0000-4000-8000-0000000017b1', 'Priya', 'pair_up', gender => 'female');
select pg_temp.member('00000000-0000-4000-8000-0000000017b2', 'Kavya', 'need_room', 'women_only', gender => 'female');
select pg_temp.member('00000000-0000-4000-8000-0000000017b3', 'Isha', 'need_room', gender => 'female', pref => 'female_only');
select pg_temp.member('00000000-0000-4000-8000-0000000017b4', 'Rohan', 'need_room', gender => 'male', budget => '[40000,60000]');
select pg_temp.member('00000000-0000-4000-8000-0000000017b5', 'Dev', 'need_room', gender => 'male',
  area => (select max(a.id) from ref.areas a));

select is(pg_temp.people('00000000-0000-4000-8000-0000000017f1'),
  array['00000000-0000-4000-8000-0000000017a1', '00000000-0000-4000-8000-0000000017b1',
        '00000000-0000-4000-8000-0000000017b2', '00000000-0000-4000-8000-0000000017b3',
        '00000000-0000-4000-8000-0000000017c1']::uuid[],
  '22. a verified woman sees seekers in her area and budget, the women-only member included; no owners, no Rohan (budget), no Dev (area)');
select is(pg_temp.people('00000000-0000-4000-8000-0000000017a1'),
  array['00000000-0000-4000-8000-0000000017b1', '00000000-0000-4000-8000-0000000017c1',
        '00000000-0000-4000-8000-0000000017f1']::uuid[],
  '23. a verified man: never the women-only member, nor someone who wants female flatmates');
select ok(not ('00000000-0000-4000-8000-0000000017b2' = any(pg_temp.people('00000000-0000-4000-8000-0000000017c1')))
      and not ('00000000-0000-4000-8000-0000000017b3' = any(pg_temp.people('00000000-0000-4000-8000-0000000017c1'))),
  '24. unverified: never the women-only member, nor someone who wants verified women');
-- Anyone may pick women-only before verifying: until DigiLocker says female, nobody sees them.
select pg_temp.member('00000000-0000-4000-8000-0000000017b6', 'Kiran', 'need_room', 'women_only');
select ok(not ('00000000-0000-4000-8000-0000000017b6' = any(pg_temp.people('00000000-0000-4000-8000-0000000017f1')))
      and not ('00000000-0000-4000-8000-0000000017b6' = any(pg_temp.people('00000000-0000-4000-8000-0000000017a1'))),
  '25. an unverified women-only member reaches nobody, not even verified women');

insert into public.swipes (swiper_id, target_id, action)
  values ('00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017b1', 'like');
select ok(not ('00000000-0000-4000-8000-0000000017b1' = any(pg_temp.people('00000000-0000-4000-8000-0000000017f1'))),
  '26. a liked person is not shown again');
insert into public.swipes (swiper_id, target_id, listing_id, action)
  values ('00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017e2', '00000000-0000-4000-8000-000000001712', 'pass');
select ok('00000000-0000-4000-8000-0000000017b3' = any(pg_temp.people('00000000-0000-4000-8000-0000000017f1')),
  '27. a room swipe does not hide people');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-0000000017b3', '00000000-0000-4000-8000-0000000017f1');
select ok(not ('00000000-0000-4000-8000-0000000017b3' = any(pg_temp.people('00000000-0000-4000-8000-0000000017f1'))),
  '28. blocks hide people either way');
update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-0000000017c1';
select ok(not ('00000000-0000-4000-8000-0000000017c1' = any(pg_temp.people('00000000-0000-4000-8000-0000000017f1')))
      and pg_temp.people('00000000-0000-4000-8000-0000000017c1') = '{}'::uuid[],
  '29. deleted members neither appear nor get candidates');

update public.profiles set suspended_until = now() + interval '1 day' where id = '00000000-0000-4000-8000-0000000017a1';
select ok(pg_temp.rooms('00000000-0000-4000-8000-0000000017a1') = '{}'::uuid[]
      and pg_temp.people('00000000-0000-4000-8000-0000000017a1') = '{}'::uuid[],
  '31. a suspended viewer gets no candidates');
update public.profiles set suspended_until = null, is_paused = true where id = '00000000-0000-4000-8000-0000000017a1';
select ok(pg_temp.rooms('00000000-0000-4000-8000-0000000017a1') <> '{}'::uuid[],
  '32. a paused viewer still browses (pausing hides only themselves)');

select ok(not has_function_privilege('authenticated', 'private.discovery_rooms(uuid, integer)', 'execute')
      and not has_function_privilege('anon', 'private.discovery_people(uuid, integer)', 'execute'),
  '30. clients cannot call the candidate functions');

select * from finish();
rollback;
