-- pgTAP: listings, rules, costs and media (T3.4, migration 0011; docs/04 §6.4, §8.2, §8.4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

-- Deferred checks (listing completeness, identity records) run per statement here.
set constraints all immediate;

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', '919600000201'),
  ('00000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', '919600000202');
insert into public.profiles (id, display_name, intent, date_of_birth) values
  ('00000000-0000-4000-8000-0000000000c1', 'Meera', 'have_room', '1998-01-01'),
  ('00000000-0000-4000-8000-0000000000c2', 'Karan', 'need_room', '2000-01-01');

create function pg_temp.listing(id uuid, owner uuid, title text default 'Sunny room near Cyber City') returns text
language sql as $$
  select format($q$insert into public.listings (id, owner_id, title, area_id, location_exact, bhk, room_type,
    furnishing, available_from, total_flatmates, current_flatmates, rent_per_person_inr, deposit_per_person_inr)
    values (%L, %L, %L, (select min(id) from ref.areas), extensions.st_point(77.0891, 28.4951)::extensions.geography,
    3, 'private', 'semi_furnished', '2026-12-15', 3, 2, 18000, 36000)$q$, id, owner, title)
$$;
create function pg_temp.photo(listing uuid, pos int) returns text
language sql as $$
  select format($q$insert into public.listing_media (listing_id, kind, storage_bucket, storage_key, sha256, position)
    values (%L, 'photo', 'listing-photos', %L, extensions.digest(%L, 'sha256'), %s)$q$,
    listing, listing::text || '/' || gen_random_uuid() || '.webp', listing::text || pos, pos)
$$;
create function pg_temp.video(listing uuid, in_app boolean default true) returns text
language sql as $$
  select format($q$insert into public.listing_media (listing_id, kind, storage_bucket, storage_key, sha256,
    duration_s, recorded_in_app, captured_at, integrity_verdict) values (%L, 'walkthrough_video', 'r2-walkthroughs', %L,
    extensions.digest('video', 'sha256'), 45, %L, now(), 'meets_device_integrity')$q$,
    listing, listing::text || '/' || gen_random_uuid() || '.mp4', in_app)
$$;
create function pg_temp.submit() returns text
language sql as $$
  select $q$update public.listings set status = 'pending_review' where id = '00000000-0000-4000-8000-00000000d001'$q$
$$;

-- ================================================================== who can list (FR-LST-01)
select throws_ok(pg_temp.listing('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-0000000000c2'),
  '23514', 'listing_owner_not_have_room', 'a member looking for a room cannot list one');
select lives_ok(pg_temp.listing('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000000c1'),
  'a have_room member can start a draft, verified or not');
select throws_ok($$update public.listings set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', 'listing_owner_not_have_room', 'nor can a listing be handed to one');

-- ================================================================== listing fields
select throws_ok(pg_temp.listing(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', 'Room'),
  '23514', null, 'titles need at least 5 characters');
select throws_ok(pg_temp.listing(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', U&'Nice room\202E here'),
  '23514', null, 'titles with bidi overrides are rejected');
select throws_ok($$update public.listings set current_flatmates = 3 where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', null, 'a full flat has no room to list');
select throws_ok($$update public.listings set address_enc = convert_to('12 MG Road, Gurugram', 'UTF8') where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', null, 'the address is stored encrypted, never as plain text');
select lives_ok($$update public.listings set address_enc = '\x01' || decode(repeat('00', 40), 'hex') where id = '00000000-0000-4000-8000-00000000d001'$$,
  'an encrypted address envelope is accepted');
update public.listings set updated_at = '2026-01-01' where id = '00000000-0000-4000-8000-00000000d001';
select ok((select updated_at > '2026-01-02' from public.listings where id = '00000000-0000-4000-8000-00000000d001'),
  'updated_at is kept by the database');
select throws_ok($$update public.listings set status = 'active', expires_at = now() + interval '30 days' where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', null, 'a live listing has a publish date');

-- ================================================================== public location (docs/04 §8.2)
select ok((select extensions.st_distance(location_exact, location_public) between 1 and 360
             from public.listings where id = '00000000-0000-4000-8000-00000000d001'),
  'the public point is a grid point within ~350 m of the pin, never the pin itself');
create temp table first_public as
  select extensions.st_astext(location_public) p from public.listings where id = '00000000-0000-4000-8000-00000000d001';
update public.listings set location_exact = extensions.st_point(77.0892, 28.4952)::extensions.geography
  where id = '00000000-0000-4000-8000-00000000d001';
select is((select extensions.st_astext(location_public) from public.listings where id = '00000000-0000-4000-8000-00000000d001'),
  (select p from first_public), 'moving the pin a few metres keeps the same public point');
select throws_ok($$update public.listings set location_public = location_exact where id = '00000000-0000-4000-8000-00000000d001'$$,
  '428C9', null, 'the public point cannot be written directly');
select throws_ok($$update public.listings set location_exact = extensions.st_point(0, 0)::extensions.geography where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', null, 'pins outside Delhi NCR are rejected');

-- ================================================================== costs (FR-LST-03)
select throws_ok($$insert into public.listing_costs (listing_id, brokerage_inr) values ('00000000-0000-4000-8000-00000000d001', 5000)$$,
  '23514', null, 'brokerage is always 0');
select throws_ok($$insert into public.listing_costs (listing_id, one_time_costs) values ('00000000-0000-4000-8000-00000000d001', '[{"label": "Broker fee", "amount_inr": 9000}]')$$,
  '23514', null, 'no brokerage disguised as a one-time cost');
select throws_ok($$insert into public.listing_costs (listing_id, one_time_costs) values ('00000000-0000-4000-8000-00000000d001', '[{"label": "Agent fee", "amount_inr": 9000}]')$$,
  '23514', null, 'nor as an agent fee');
select throws_ok($$insert into public.listing_costs (listing_id, one_time_costs) values ('00000000-0000-4000-8000-00000000d001', '[{"label": "Setup", "amount_inr": 9.5}]')$$,
  '23514', null, 'one-time costs are whole rupees');
select throws_ok($$insert into public.listing_costs (listing_id, one_time_costs) values ('00000000-0000-4000-8000-00000000d001', '[{"label": "Setup", "amount_inr": 900, "note": "x"}]')$$,
  '23514', null, 'one-time costs have only a label and an amount');
select throws_ok($$insert into public.listing_costs (listing_id, one_time_costs) values ('00000000-0000-4000-8000-00000000d001', '{"label": "Setup"}')$$,
  '23514', null, 'one-time costs are a list');
select lives_ok($$insert into public.listing_costs (listing_id, maintenance_inr, electricity_estimate_inr, wifi_inr, help_inr, one_time_costs)
  values ('00000000-0000-4000-8000-00000000d001', 1500, 1200, 400, 1000, '[{"label": "Setup", "amount_inr": 2000}]')$$,
  'honest costs are accepted');
select is((select recurring_costs_per_person_inr from public.listing_costs where listing_id = '00000000-0000-4000-8000-00000000d001'),
  4100, 'recurring costs per person are the sum of the monthly costs');

-- ================================================================== media (docs/04 §8.4)
select throws_ok(replace(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 0), '.webp', '.jpg'),
  '23514', null, 'photos are WebP');
select throws_ok(replace(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 0), '''00000000-0000-4000-8000-00000000d001/', '''00000000-0000-4000-8000-00000000d009/'),
  '23514', null, 'a file sits under its own listing');
select throws_ok(replace(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 0), '''listing-photos''', '''profile-photos'''),
  '23514', null, 'photos live in the listing-photos bucket');
select throws_ok(pg_temp.video('00000000-0000-4000-8000-00000000d001', false),
  '23514', null, 'the walkthrough video is recorded in the app');
select throws_ok(replace(pg_temp.video('00000000-0000-4000-8000-00000000d001'), ', 45,', ', 10,'),
  '23514', null, 'walkthroughs run 30–90 s');
select throws_ok(replace(pg_temp.video('00000000-0000-4000-8000-00000000d001'), '''meets_device_integrity''', 'null'),
  '23514', null, 'a walkthrough video carries its Play Integrity verdict');

-- ================================================================== submitting (FR-LST-02..05)
select throws_ok(pg_temp.submit(), '23514', 'listing_incomplete', 'no rules yet: cannot submit');
insert into public.listing_rules (listing_id, bachelors_allowed, food_rule, guests_rule, pets_allowed, smoking_allowed, gender_rule)
  values ('00000000-0000-4000-8000-00000000d001', true, 'any', 'day_only', false, false, 'any');
select lives_ok(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 0), 'first photo');
select lives_ok(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 1), 'second photo');
select throws_ok(pg_temp.submit(), '23514', 'listing_incomplete', 'two photos are not enough');
select lives_ok(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 2), 'third photo');
select throws_ok(pg_temp.submit(), '23514', 'listing_incomplete', 'no walkthrough video yet');
select lives_ok(pg_temp.video('00000000-0000-4000-8000-00000000d001'), 'the walkthrough video');
select throws_ok(pg_temp.video('00000000-0000-4000-8000-00000000d001'), '23505', null, 'only one walkthrough video');
select throws_ok(pg_temp.submit(), '23514', 'listing_incomplete', 'the owner is not DigiLocker-verified yet');

insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-0000000000c1', '\x01' || decode(repeat('00', 40), 'hex'), '1998-01-01', 'female', decode(repeat('c1', 32), 'hex'));
update public.profiles set is_identity_verified = true, verified_gender = 'female' where id = '00000000-0000-4000-8000-0000000000c1';
select lives_ok(pg_temp.submit(), 'complete, verified: goes to review');
select lives_ok($$update public.listings set status = 'active', published_at = now(), expires_at = now() + interval '30 days'
  where id = '00000000-0000-4000-8000-00000000d001'$$, 'and can go live');

-- A live listing stays complete.
select throws_ok($$delete from public.listing_media where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'photo' and position = 2$$,
  '23514', 'listing_incomplete', 'a live listing cannot drop below 3 photos');
select throws_ok($$update public.listing_media set moderation_status = 'rejected' where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'photo' and position = 0$$,
  '23514', 'listing_incomplete', 'a rejected photo leaves a live listing with too few');
select throws_ok($$update public.listing_media set moderation_status = 'rejected' where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'walkthrough_video'$$,
  '23514', 'listing_incomplete', 'a rejected video leaves a live listing incomplete');
select throws_ok($$delete from public.listing_rules where listing_id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', 'listing_incomplete', 'a live listing keeps its rules');
select throws_ok($$delete from public.listing_costs where listing_id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', 'listing_incomplete', 'a live listing keeps its costs');
select lives_ok($$update public.listings set risk_score = 40, expires_at = now() + interval '60 days' where id = '00000000-0000-4000-8000-00000000d001'$$,
  'moderation and confirm updates on a live listing');

-- An owner who stops qualifying: live listings are paused, and stay updatable.
update public.profiles set intent = 'need_room' where id = '00000000-0000-4000-8000-0000000000c1';
select is((select status::text from public.listings where id = '00000000-0000-4000-8000-00000000d001'),
  'paused', 'an owner who no longer has a room has their live listing paused');
select lives_ok($$update public.listings set status = 'expired' where id = '00000000-0000-4000-8000-00000000d001'$$,
  'the expiry job can still expire it');
select throws_ok($$update public.listings set status = 'active' where id = '00000000-0000-4000-8000-00000000d001'$$,
  '23514', 'listing_incomplete', 'and it cannot go live again');
update public.profiles set intent = 'have_room' where id = '00000000-0000-4000-8000-0000000000c1';
select lives_ok($$update public.listings set status = 'draft' where id = '00000000-0000-4000-8000-00000000d001'$$,
  'back to draft for editing');
select lives_ok($$delete from public.listing_media where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'photo' and position = 2$$,
  'a draft can lose photos');

-- At most 12 photos.
select lives_ok(format('do $d$ begin for i in 2..11 loop execute pg_temp.photo(%L, i); end loop; end $d$',
  '00000000-0000-4000-8000-00000000d001'), 'up to 12 photos');
select throws_ok(replace(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 11), ', 11)', ', 12)'),
  '23514', null, 'a 13th photo is refused');
select lives_ok(pg_temp.photo('00000000-0000-4000-8000-00000000d001', 5)
    || $$ on conflict (listing_id, kind, position) do update set storage_key = excluded.storage_key, sha256 = excluded.sha256$$,
  'replacing a photo on a full listing is an upsert');
select throws_ok($$update public.listing_media set listing_id = '00000000-0000-4000-8000-00000000d003'
    where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'photo' and position = 5$$,
  '23514', null, 'a file cannot move to another listing without its key');
select is((select count(*)::int from public.listing_media where listing_id = '00000000-0000-4000-8000-00000000d001' and kind = 'photo'),
  12, 'twelve photos stored');

-- ================================================================== one transaction, any order
-- The completeness check waits for commit: a listing can be submitted first and filled after.
set constraints all deferred;
select lives_ok(pg_temp.listing('00000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-0000000000c1'), 'second listing');
update public.listings set status = 'pending_review' where id = '00000000-0000-4000-8000-00000000d003';
insert into public.listing_rules (listing_id, bachelors_allowed, food_rule, guests_rule, pets_allowed, smoking_allowed, gender_rule)
  values ('00000000-0000-4000-8000-00000000d003', true, 'veg_only', 'allowed', true, false, 'female_only');
insert into public.listing_costs (listing_id) values ('00000000-0000-4000-8000-00000000d003');
select lives_ok(format('do $d$ begin for i in 0..2 loop execute pg_temp.photo(%L, i); end loop; execute pg_temp.video(%L); end $d$',
  '00000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-00000000d003'), 'parts added after submitting');
select lives_ok('set constraints all immediate', 'complete by commit time: accepted');

-- ================================================================== access (docs/04 §5)
select ok(not has_table_privilege('authenticated', 'public.listings', 'select')
      and not has_table_privilege('anon', 'public.listings', 'select')
      and not has_table_privilege('authenticated', 'public.listing_media', 'insert')
      and not has_table_privilege('authenticated', 'public.listing_costs', 'select')
      and not has_table_privilege('authenticated', 'public.listing_rules', 'select'),
  'clients cannot read or write listings directly; the API does');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.listings'::regclass, 'public.listing_rules'::regclass,
                         'public.listing_costs'::regclass, 'public.listing_media'::regclass)),
  'RLS is on for all listing tables');

-- Deleting the owner removes the listing and its parts.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000c1';
select is((select count(*)::int from public.listing_media where listing_id = '00000000-0000-4000-8000-00000000d001'),
  0, 'deleting the account removes the listing media rows');

select * from finish();
rollback;
