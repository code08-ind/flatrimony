-- pgTAP: notifications and the listing expiry reminder column (T3.10, migration 0014).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', '919600000401');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000000f1', 'Meera', 'have_room');

select lives_ok($$insert into public.notifications (user_id, type, title_key, params, deep_link)
  values ('00000000-0000-4000-8000-0000000000f1', 'listing.expiring', 'notifications.listing.expiring',
          '{"listingId": "00000000-0000-4000-8000-00000000f001"}', 'flatrimony://my-flat')$$,
  'a reminder: a type, an i18n key, ids only, an app link');
select throws_ok($$insert into public.notifications (user_id, type, title_key)
  values ('00000000-0000-4000-8000-0000000000f1', 'Listing Expiring!', 'notifications.listing.expiring')$$,
  '23514', null, 'types are dotted lower-case names');
select throws_ok($$insert into public.notifications (user_id, type, title_key, deep_link)
  values ('00000000-0000-4000-8000-0000000000f1', 'listing.expiring', 'notifications.listing.expiring', 'javascript:alert(1)')$$,
  '23514', null, 'deep links are app or https links only');
select throws_ok($$insert into public.notifications (user_id, type, title_key, params)
  values ('00000000-0000-4000-8000-0000000000f1', 'listing.expiring', 'notifications.listing.expiring', '["x"]')$$,
  '23514', null, 'params are an object');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'select')
      and not has_table_privilege('anon', 'public.notifications', 'select'),
  'clients read notifications through the API only');
select has_column('public', 'listings', 'expiry_reminded_for', 'listings remember which expiry they were reminded of');
select lives_ok($$insert into public.notifications (user_id, type, title_key, deep_link)
  values ('00000000-0000-4000-8000-0000000000f1', 'match.created', 'notifications.match.created', 'https://flatrimony.in/m/abc?x=1')$$,
  'universal links are allowed');

-- A listing coming back to active with its week over gets a fresh 7 days (moderation, T6).
-- (The completeness check is deferred to commit, and this test rolls back.)
insert into public.listings (id, owner_id, status, title, area_id, location_exact, bhk, room_type, furnishing,
  available_from, total_flatmates, current_flatmates, rent_per_person_inr, deposit_per_person_inr, published_at, expires_at)
values ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000f1', 'pending_review', 'Held room for testing',
  (select min(id) from ref.areas), extensions.st_point(77.09, 28.49)::extensions.geography, 3, 'private', 'furnished',
  '2026-12-15', 3, 2, 18000, 0, now() - interval '20 days', now() - interval '3 days');
update public.listings set status = 'active' where id = '00000000-0000-4000-8000-00000000f001';
select ok((select expires_at > now() + interval '6 days 23 hours' from public.listings where id = '00000000-0000-4000-8000-00000000f001'),
  'going live again with the week over starts a new week');
update public.listings set status = 'paused' where id = '00000000-0000-4000-8000-00000000f001';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000f1';
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-4000-8000-0000000000f1'),
  0, 'notifications go with the account');

select * from finish();
rollback;
