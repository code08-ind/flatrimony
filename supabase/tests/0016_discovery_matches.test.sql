-- pgTAP: discovery, swipes and matches (T4.2, migration 0016).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'super_like', E'hi​')$$,
  '23514', null, '10. notes are visible text');
select lives_ok($$insert into public.swipes (swiper_id, target_id, action, note)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 'super_like', 'Love your biodata!')$$,
  '11. a super like with a note');

-- Matches ---------------------------------------------------------------------
select lives_ok($$insert into public.matches (id, user_a, user_b, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016e1', '00000000-0000-4000-8000-0000000016a1',
          '00000000-0000-4000-8000-0000000016c3', 82, '{"agreements": []}')$$,
  '12. a person match in canonical order');
select throws_ok($$insert into public.matches (user_a, user_b, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016c3', '00000000-0000-4000-8000-0000000016a1', 82, '{}')$$,
  '23514', null, '13. the pair is stored in canonical order only');
select throws_ok($$insert into public.matches (user_a, user_b, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3', 70, '{}')$$,
  '23505', null, '14. one match per person pair');
select lives_ok($$insert into public.matches (id, user_a, user_b, listing_id, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016e2', '00000000-0000-4000-8000-0000000016a1',
          '00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-00000000160f', 76, '{}')$$,
  '15. a room match with its owner');
select throws_ok($$insert into public.matches (user_a, user_b, listing_id, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016c3',
          '00000000-0000-4000-8000-00000000160f', 76, '{}')$$,
  '23514', 'match_listing_owner', '16. a room match without the room''s owner is refused');
select throws_ok($$insert into public.matches (user_a, user_b, score, breakdown)
  values ('00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-0000000016c3', 101, '{}')$$,
  '23514', null, '17. scores are 0-100');
select throws_ok($$update public.matches set status = 'closed', closed_at = now()
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '23514', null, '18. a closed match needs its reason');
select lives_ok($$update public.matches set status = 'closed', closed_at = now(), closed_reason = 'unmatched'
  where id = '00000000-0000-4000-8000-0000000016e1'$$,
  '19. closed with a reason and a time');

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

-- What a member sees (RLS) --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000016a1"}';
select is((select count(*)::int from public.matches), 2, '24. a member sees their own matches');
select is((select count(*)::int from public.match_decisions), 1,
  '25. only their own "still interested?" answer, never the other''s');
select is((select count(*)::int from public.contact_shares), 1, '26. the contact shares of their matches');
select throws_ok($$select count(*) from public.swipes$$, '42501', null,
  '27. swipes, blocks and the deck cache stay with the API');
reset role;

select * from finish();
rollback;
