-- pgTAP: joiners in listing text (migration 0012).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(public.is_display_text(U&'Family flat \D83D\DC68\200D\D83D\DC69\200D\D83D\DC67'), 'an emoji family sequence is display text');
select ok(public.is_display_text(U&'\0915\094D\200D\0937 room'), 'a Hindi conjunct with a joiner is display text');
select ok(not public.is_display_text(U&'\200DNice room'), 'a joiner at the start is refused');
select ok(not public.is_display_text(U&'Nice \200D room'), 'a joiner next to a space is refused');
select ok(not public.is_display_text(U&'\200D\200D\200D'), 'joiners alone are refused');
select ok(not public.is_display_text(U&'Nice\200Broom'), 'other zero-width characters are still refused');
select ok(not public.is_human_text(U&'\0915\094D\200D\0937'), 'names still refuse joiners');
select ok(public.valid_one_time_costs(jsonb_build_array(jsonb_build_object('label', U&'\0915\094D\200D\0937 fee', 'amount_inr', 500))),
  'a cost label may use a joiner');

select * from finish();
rollback;
