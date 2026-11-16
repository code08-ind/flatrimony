-- pgTAP: banned identities (T2.3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('private', 'banned_identities', 'banned_identities lives in private');
select ok((select relrowsecurity from pg_class where oid = 'private.banned_identities'::regclass), 'RLS on banned_identities');
select lives_ok($$insert into private.banned_identities (phone_hash, reason) values (decode(repeat('aa', 32), 'hex'), 'broker')$$, 'a phone ban is stored');
select throws_ok($$insert into private.banned_identities (reason) values ('nothing')$$, '23514', null, 'a ban needs at least one hash');
select throws_ok($$insert into private.banned_identities (phone_hash, reason) values ('\x01', 'x')$$, '23514', null, 'hashes are 32-byte HMACs, never raw values');
select throws_ok($$insert into private.banned_identities (device_hash, reason) values (decode(repeat('bb', 32), 'hex'), '   ')$$, '23514', null, 'a ban needs a reason');

set local role authenticated;
select throws_ok($$select 1 from private.banned_identities$$, '42501', null, 'clients cannot read bans');
reset role;
set local role anon;
select throws_ok($$select 1 from private.banned_identities$$, '42501', null, 'anon cannot read bans');
reset role;

select * from finish();
rollback;
