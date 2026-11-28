-- pgTAP: discovery, swipes and matches (T4.2, migration 0016).
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- a1 < b2 < c3 (canonical order); b2 owns a room.
insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000016a1', 'authenticated', 'authenticated', '919600001601'),
  ('00000000-0000-4000-8000-0000000016b2', 'authenticated', 'authenticated', '919600001602'),
  ('00000000-0000-4000-8000-0000000016c3', 'authenticated', 'authenticated', '919600001603');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000016a1', 'Asha', 'need_room'),
  ('00000000-0000-4000-8000-0000000016b2', 'Meera', 'have_room'),
  ('00000000-0000-4000-8000-0000000016c3', 'Riya', 'need_room');
insert into public.listings (id, owner_id, title, area_id, location_exact, bhk, room_type, furnishing,
  available_from, total_flatmates, current_flatmates, rent_per_person_inr, deposit_per_person_inr)
values ('00000000-0000-4000-8000-00000000160f', '00000000-0000-4000-8000-0000000016b2', 'Room near Cyber City',
  (select min(id) from ref.areas), extensions.st_point(77.0891, 28.4951)::extensions.geography,
  3, 'private', 'semi_furnished', '2026-12-15', 3, 2, 18000, 36000);

-- Swipes ---------------------------------------------------------------------
select lives_ok($$insert into public.swipes (swiper_id, target_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3', 'like')$$,
  '1. a person swipe');
select lives_ok($$insert into public.swipes (swiper_id, target_id, listing_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2',
          '00000000-0000-4000-8000-00000000160f', 'like')$$,
  '2. a room swipe targets the room''s owner');
select throws_ok($$insert into public.swipes (swiper_id, target_id, listing_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3',
          '00000000-0000-4000-8000-00000000160f', 'like')$$,
  '23514', 'swipe_listing_owner', '3. a room swipe at someone other than its owner is refused');
select throws_ok($$insert into public.swipes (swiper_id, target_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3', 'pass')$$,
  '23505', null, '4. one swipe per person card (a re-swipe updates the row)');
select throws_ok($$insert into public.swipes (swiper_id, target_id, listing_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2',
          '00000000-0000-4000-8000-00000000160f', 'pass')$$,
  '23505', null, '5. one swipe per room');
select lives_ok($$insert into public.swipes (swiper_id, target_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2', 'pass')$$,
  '6. the person card of a room owner is separate from the room');
select throws_ok($$insert into public.swipes (swiper_id, target_id, action)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016a1', 'like')$$,
  '23514', null, '7. nobody swipes themselves');
select throws_ok($$insert into public.swipes (swiper_id, target_id, action, note)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'like', 'hi')$$,
  '23514', null, '8. only a super like carries a note');
select throws_ok($$insert into public.swipes (swiper_id, target_id, action, note)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'super_like', repeat('x', 141))$$,
  '23514', null, '9. notes are at most 140 characters');
select throws_ok($$insert into public.swipes (swiper_id, target_id, action, note)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'super_like', 'hi' || chr(8203))$$,
  '23514', null, '10. notes are visible text');
select lives_ok($$insert into public.swipes (swiper_id, target_id, action, note)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'super_like', 'Love your biodata!')$$,
  '11. a super like with a note');

-- Matches ---------------------------------------------------------------------
select lives_ok($$insert into public.matches (id, user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016e1', '00000000-0000-4000-8000-0000000016a1',
          '00000000-0000-4000-8000-0000000016c3', 'person', 82, '{"agreements": []}')$$,
  '12. a person match in canonical order');
select throws_ok($$insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'person', 82, '{}')$$,
  '23514', null, '13. the pair is stored in canonical order only');
select throws_ok($$insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3', 'person', 70, '{}')$$,
  '23505', null, '14. one person match per pair');
select lives_ok($$insert into public.matches (id, user_a, user_b, kind, listing_id, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016a1',
          '00000000-0000-4000-8000-0000000016b2', 'room', '00000000-0000-4000-8000-00000000160f', 76, '{}')$$,
  '15. a room match with its owner');
select throws_ok($$insert into public.matches (user_a, user_b, kind, listing_id, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3',
          'room', '00000000-0000-4000-8000-00000000160f', 76, '{}')$$,
  '23514', 'match_listing_owner', '16. a room match without the room''s owner is refused');
select throws_ok($$insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-0000000016c3', 'person', 101, '{}')$$,
  '23514', null, '17. scores are 0-100');
select throws_ok($$update public.matches set status = 'closed', closed_at = now()
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '23514', null, '18. a closed match needs its reason');
select throws_ok($$update public.matches set closed_by = '00000000-0000-4000-8000-0000000016a1'
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '23514', null, '18b. an open match has no closer');
select throws_ok($$update public.matches set status = 'closed', closed_at = now(), closed_reason = 'unmatched',
    closed_by = '00000000-0000-4000-8000-0000000016b2'
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '23514', null, '18c. the closer is one of the two');
select lives_ok($$update public.matches set status = 'closed', closed_at = now(), closed_reason = 'unmatched',
    closed_by = '00000000-0000-4000-8000-0000000016a1'
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '19. closed by a member, with a reason and a time');
select throws_ok($$insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-0000000016c3', 'room', 50, '{}')$$,
  '23514', 'match_listing_owner', '19b. a room match is made for a room');
select throws_ok($$insert into public.matches (user_a, user_b, kind, listing_id, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2', 'person',
          '00000000-0000-4000-8000-00000000160f', 50, '{}')$$,
  '23514', null, '19c. a person match has no listing');
select throws_ok($$update public.matches set user_b = '00000000-0000-4000-8000-0000000016c3'
  where id = '00000000-0000-4000-8000-0000000016e2'$$,
  '23514', 'match_immutable', '19d. a match keeps its members');
select throws_ok($$update public.matches set kind = 'person', listing_id = null
  where id = '00000000-0000-4000-8000-0000000016e2'$$,
  '23514', 'match_immutable', '19e. a match keeps its kind');
select throws_ok($$update public.listings set owner_id = '00000000-0000-4000-8000-0000000016c3'
  where id = '00000000-0000-4000-8000-00000000160f'$$,
  '23514', 'listing_owner_immutable', '19f. a listing keeps its owner');
select throws_ok($$insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-0000000016c3', 'person', 50, '[]')$$,
  '23514', null, '19g. the breakdown is an object');

-- Decisions and contact shares --------------------------------------------------
select lives_ok($$insert into public.match_decisions (match_id, user_id, still_interested)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016a1', true)$$,
  '20. a member decides');
select throws_ok($$insert into public.match_decisions (match_id, user_id, still_interested)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016c3', true)$$,
  '23514', 'not_match_member', '21. an outsider cannot decide');
select throws_ok($$insert into public.contact_shares (match_id, user_id)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016c3')$$,
  '23514', 'not_match_member', '22. an outsider cannot share contacts in a match');
insert into public.match_decisions (match_id, user_id, still_interested)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016b2', false);
insert into public.contact_shares (match_id, user_id)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016b2');

-- Blocks ------------------------------------------------------------------------
select throws_ok($$insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016a1')$$,
  '23514', null, '23. nobody blocks themselves');
insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1');
insert into public.deck_cache (user_id, mode, items, params_hash)
  values ('00000000-0000-4000-8000-0000000016a1', 'rooms', '[]', 'h1');
select throws_ok($$insert into public.deck_cache (user_id, mode, items, params_hash)
  values ('00000000-0000-4000-8000-0000000016c3', 'rooms', '{}', 'h1')$$,
  '23514', null, '23b. the deck cache holds an array');

-- A match a1 is not in, with its own decision and contact share (for the RLS checks below).
insert into public.matches (id, user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016e3', '00000000-0000-4000-8000-0000000016b2',
          '00000000-0000-4000-8000-0000000016c3', 'person', 64, '{}');
insert into public.contact_shares (match_id, user_id)
  values ('00000000-0000-4000-8000-0000000016e3', '00000000-0000-4000-8000-0000000016c3');

-- What a member sees (RLS) --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000016a1"}';
select is((select array_agg(id order by id) from public.matches),
  array['00000000-0000-4000-8000-0000000016e1', '00000000-0000-4000-8000-0000000016e2']::uuid[],
  '24. a member sees exactly their own matches');
select is((select count(*)::int from public.match_decisions), 1,
  '25. only their own "still interested?" answer, never the other''s');
select is((select array_agg(match_id) from public.contact_shares),
  array['00000000-0000-4000-8000-0000000016e2']::uuid[],
  '26. only the contact shares of their own matches');
select throws_ok($$select count(*) from public.swipes$$, '42501', null, '27. swipes stay with the API');
select throws_ok($$select count(*) from public.blocks$$, '42501', null, '27b. blocks stay with the API');
select throws_ok($$select count(*) from public.deck_cache$$, '42501', null, '27c. the deck cache stays with the API');
reset role;

-- A deleted room keeps its match as a room match: no clash with the pair's person match.
insert into public.matches (user_a, user_b, kind, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2', 'person', 70, '{}');
select lives_ok($$delete from public.listings where id = '00000000-0000-4000-8000-00000000160f'$$,
  '28. a room can be deleted while the pair also has a person match');
select is((select kind || ':' || coalesce(listing_id::text, 'none') from public.matches
           where id = '00000000-0000-4000-8000-0000000016e2'),
  'room:none', '29. its match stays a room match, without the listing');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in
             ('swipes', 'matches', 'match_decisions', 'contact_shares', 'deck_cache', 'blocks')),
  '30. RLS is on for all six tables');
select is((select array_agg(tablename::text order by tablename) from pg_publication_tables
           where pubname = 'supabase_realtime' and tablename in ('matches', 'match_decisions')),
  array['matches'], '31. realtime carries matches, never the decisions');

select * from finish();
rollback;
