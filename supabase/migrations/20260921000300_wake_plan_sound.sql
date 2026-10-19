-- Android notification-channel sounds are selected per wake plan. Existing
-- plans keep the original ZO-ZAR alarm sound when this migration is applied.
alter table public.wake_plans
  add column if not exists sound_key text not null default 'zo-zar';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wake_plans_sound_key_check'
      and conrelid = 'public.wake_plans'::regclass
  ) then
    alter table public.wake_plans
      add constraint wake_plans_sound_key_check
      check (sound_key in ('zo-zar', 'default'));
  end if;
end;
$$;
