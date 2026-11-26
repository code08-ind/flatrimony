-- pgTAP: automatic listing check findings (T3.8, migration 0013).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', '919600000301');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000000e1', 'Meera', 'have_room');
insert into public.listings (id, owner_id, title, area_id, location_exact, bhk, room_type, furnishing,
  available_from, total_flatmates, current_flatmates, rent_per_person_inr, deposit_per_person_inr)
values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000000e1', 'Sunny room near Cyber City',
  (select min(id) from ref.areas), extensions.st_point(77.0891, 28.4951)::extensions.geography,
  3, 'private', 'semi_furnished', '2026-12-15', 3, 2, 18000, 36000);

select lives_ok($$insert into private.listing_flags (listing_id, kind, weight, details)
  values ('00000000-0000-4000-8000-00000000e001', 'contact_details', 40, '{"phoneIn": "description"}')$$,
  'a finding names its kind and field');
select throws_ok($$insert into private.listing_flags (listing_id, kind, weight)
  values ('00000000-0000-4000-8000-00000000e001', 'looks_shady', 40)$$,
  '23514', null, 'only the known kinds');
select throws_ok($$insert into private.listing_flags (listing_id, kind, weight, details)
  values ('00000000-0000-4000-8000-00000000e001', 'broker_words', 40, '["title"]')$$,
  '23514', null, 'details are an object');
select throws_ok($$insert into private.listing_flags (listing_id, kind, weight)
  values ('00000000-0000-4000-8000-00000000e001', 'broker_words', 0)$$,
  '23514', null, 'weights are 1-100');
select ok(not has_table_privilege('authenticated', 'private.listing_flags', 'select')
      and not has_table_privilege('anon', 'private.listing_flags', 'select'),
  'clients never see findings');
delete from public.listings where id = '00000000-0000-4000-8000-00000000e001';
select is((select count(*)::int from private.listing_flags where listing_id = '00000000-0000-4000-8000-00000000e001'),
  0, 'findings go with their listing');

select * from finish();
rollback;
