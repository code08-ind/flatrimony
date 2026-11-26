-- 0012 — Joiners in listing text (T3.5 QA; docs/04 §15.6).
--
-- is_human_text() refuses every zero-width character, which is right for names. But a listing
-- title or a cost label written in Hindi may need a zero-width joiner (U+200D) or non-joiner
-- (U+200C) to shape a conjunct, and emoji sequences (a family) are joined with U+200D. Text
-- written for others keeps them when they sit between two visible characters; anything else
-- is still refused. Mirrors displayText() in @flatrimony/shared.

create or replace function public.is_display_text(t text) returns boolean
language sql immutable
set search_path = ''
as $$
  select public.is_human_text(
    regexp_replace(t, '(?<=[^[:space:]])[\u200C\u200D](?=[^[:space:]])', '', 'g'))
$$;
grant execute on function public.is_display_text(text) to public;  -- CHECK constraints need it

alter table public.listings drop constraint listings_title_chk;
alter table public.listings add constraint listings_title_chk
  check (char_length(title) between 5 and 80 and public.is_display_text(title));

-- As in 0011, with is_display_text for the label.
create or replace function public.valid_one_time_costs(costs jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(costs) = 'array'
     and jsonb_array_length(costs) <= 10
     and not exists (
       select 1 from jsonb_array_elements(costs) item
       where jsonb_typeof(item) <> 'object'
          or (select count(*) from jsonb_object_keys(item)) <> 2
          or jsonb_typeof(item -> 'label') <> 'string'
          or jsonb_typeof(item -> 'amount_inr') <> 'number'
          or char_length(item ->> 'label') not between 1 and 40
          or not public.is_display_text(item ->> 'label')
          or (item ->> 'label') ~* '(broker|dalal|commission|agent|finder)'
          or (item ->> 'amount_inr')::numeric <> trunc((item ->> 'amount_inr')::numeric)
          or (item ->> 'amount_inr')::numeric not between 0 and 1000000)
$$;
