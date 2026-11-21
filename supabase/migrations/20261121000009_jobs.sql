-- 0009 — Job queue (docs/04 §11, ADR-0006; pulled forward from 0012 for T1.14, the worker skeleton).
--
-- A Postgres table is the whole queue: the worker (a Cloud Run Job started by Cloud Scheduler every
-- 5 minutes and daily) claims ready rows with FOR UPDATE SKIP LOCKED, so overlapping runs never take
-- the same job. Failed jobs back off exponentially; a job that used all its attempts stays undone
-- (done_at null) for an alert and a human. Only the worker and the API (server side) touch it.

create table private.jobs (
  id           bigserial primary key,
  kind         text not null,               -- e.g. 'media.process', 'commute.compute', 'account.purge'
  payload      jsonb not null default '{}',
  run_after    timestamptz not null default now(),
  attempts     smallint not null default 0,
  max_attempts smallint not null default 5,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  dedupe_key   text unique,                 -- optional: one pending job per key (e.g. 'commute:<user>')
  constraint jobs_kind_chk check (kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$' and char_length(kind) <= 100),
  constraint jobs_payload_chk check (jsonb_typeof(payload) = 'object'),
  constraint jobs_attempts_chk check (attempts >= 0 and max_attempts between 1 and 20),
  constraint jobs_lock_chk check ((locked_at is null) = (locked_by is null)),
  constraint jobs_error_len_chk check (last_error is null or char_length(last_error) <= 2000)
);

-- Ready jobs, in order (the claim query).
create index jobs_ready_idx on private.jobs (run_after)
  where done_at is null and locked_at is null;
-- Locked jobs (releasing locks of crashed runs).
create index jobs_locked_idx on private.jobs (locked_at)
  where done_at is null and locked_at is not null;
-- Jobs that used all their attempts (the alert and the admin view).
create index jobs_dead_idx on private.jobs (created_at)
  where done_at is null and locked_at is null and attempts >= max_attempts;

comment on table private.jobs is
  'Background job queue (docs/04 §11). Claimed by the worker with FOR UPDATE SKIP LOCKED; never exposed to clients.';

alter table private.jobs enable row level security;
revoke all on private.jobs from public, anon, authenticated;
revoke all on sequence private.jobs_id_seq from public, anon, authenticated;
