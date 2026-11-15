-- pgTAP: reference data access rules (docs/04 §2, §16). Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Structure
select has_schema('private');
select has_schema('ref');
select has_table('ref', 'areas', 'ref.areas exists');
select has_table('ref', 'app_config', 'ref.app_config exists');
select ok((select relrowsecurity from pg_class where oid = 'ref.areas'::regclass), 'RLS on ref.areas');
select ok((select relrowsecurity from pg_class where oid = 'ref.app_config'::regclass), 'RLS on ref.app_config');
select ok((select relrowsecurity from pg_class where oid = 'ref.products'::regclass), 'RLS on ref.products');

-- Constraints
select throws_ok(
  $$insert into ref.products (code, name_en, name_hi, price_paise, duration_days) values ('move_pass_30d','x','x',0,30)$$,
  '23514', null, 'product price must be positive');
select throws_ok(
  $$insert into ref.areas (slug, name_en, name_hi, city, centroid) values ('x','x','x','mumbai', st_point(72.8,19.0)::geography)$$,
  '23514', null, 'areas are NCR cities only');
select throws_ok(
  $$insert into ref.scenario_questions (id, attribute, prompt_en, prompt_hi, options) values ('q','cleaning','x','x','[{"id":"a"}]')$$,
  '23514', null, 'scenario needs 2-5 options');

-- Seeded config from the docs
select is((select value from ref.app_config where key = 'daily_like_limit'), '50'::jsonb, 'daily like limit seeded');

-- Anonymous clients: public config readable, private config not, no writes.
set local role anon;
select is((select count(*) from ref.app_config where key = 'daily_like_limit')::int, 1, 'anon reads public config');
select is((select count(*) from ref.app_config where key = 'new_account_daily_conversations')::int, 0, 'anon cannot read non-public config');
select throws_ok($$insert into ref.app_config (key, value) values ('x', '1')$$, '42501', null, 'anon cannot write ref');
select throws_ok($$select 1 from private.nonexistent$$, '42501', null, 'anon has no access to the private schema');
reset role;

set local role authenticated;
select throws_ok($$update ref.app_config set value = '999' where key = 'daily_like_limit'$$, '42501', null, 'authenticated cannot write ref');
reset role;

select * from finish();
rollback;
