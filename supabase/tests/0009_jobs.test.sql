-- pgTAP: job queue (T1.14, docs/04 §11).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('private', 'jobs', 'jobs lives in private');
select ok((select relrowsecurity from pg_class where oid = 'private.jobs'::regclass), 'RLS on jobs');

select lives_ok($$insert into private.jobs (kind) values ('photos.sweep-uploads')$$, 'a job with a dotted kind is stored');
select throws_ok($$insert into private.jobs (kind) values ('Sweep Uploads')$$, '23514', null, 'kinds are lower-case dotted names');
select throws_ok($$insert into private.jobs (kind, payload) values ('a.b', '[1]')$$, '23514', null, 'the payload is a JSON object');
select throws_ok($$insert into private.jobs (kind, max_attempts) values ('a.b', 0)$$, '23514', null, 'at least one attempt');
select throws_ok($$insert into private.jobs (kind, locked_at) values ('a.b', now())$$, '23514', null, 'a lock names its holder');
select lives_ok($$insert into private.jobs (kind, dedupe_key) values ('commute.compute', 'commute:u1')$$, 'a dedupe key is stored');
select throws_ok($$insert into private.jobs (kind, dedupe_key) values ('commute.compute', 'commute:u1')$$, '23505', null, 'one job per dedupe key');

-- The claim from docs/04 §11 takes ready jobs once: a second claim gets nothing while they are locked.
delete from private.jobs;
insert into private.jobs (kind, run_after) values
  ('a.ready', now() - interval '1 minute'),
  ('a.later', now() + interval '1 hour');
insert into private.jobs (kind, attempts, max_attempts) values ('a.dead', 5, 5);
create temp table claimed as
  with c as (
    update private.jobs j set locked_at = now(), locked_by = 'w1', attempts = attempts + 1
    where j.id in (
      select id from private.jobs
      where done_at is null and locked_at is null and run_after <= now() and attempts < max_attempts
      order by run_after for update skip locked limit 20)
    returning j.kind)
  select * from c;
select results_eq('select kind from claimed', $$values ('a.ready')$$,
  'only ready jobs are claimed (not future ones, not ones out of attempts)');
select is_empty($$
  select id from private.jobs
  where done_at is null and locked_at is null and run_after <= now() and attempts < max_attempts
  for update skip locked$$, 'a claimed job is not claimable again');

set local role authenticated;
select throws_ok($$select 1 from private.jobs$$, '42501', null, 'clients cannot read jobs');
select throws_ok($$insert into private.jobs (kind) values ('a.b')$$, '42501', null, 'clients cannot add jobs');
reset role;
set local role anon;
select throws_ok($$select 1 from private.jobs$$, '42501', null, 'anon cannot read jobs');
reset role;

select * from finish();
rollback;
