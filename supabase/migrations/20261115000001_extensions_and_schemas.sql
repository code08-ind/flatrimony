-- 0001 — Extensions and schemas (docs/04-database-design.md §5, §15).
-- Extensions go into the `extensions` schema (Supabase convention); it is on every role's search_path.

create schema if not exists extensions;

create extension if not exists postgis  with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- `private` is never exposed through the Supabase Data API (see supabase/config.toml [api].schemas).
create schema if not exists private;
-- `ref` holds read-only reference data, exposed read-only to anon + authenticated.
create schema if not exists ref;

comment on schema private is 'Sensitive tables (identity, contact, bans, audit, jobs). Never exposed via the Data API.';
comment on schema ref     is 'Reference data (areas, habit tags, scenario questions, products, app config). Read-only for clients.';

revoke all on schema private from public;
