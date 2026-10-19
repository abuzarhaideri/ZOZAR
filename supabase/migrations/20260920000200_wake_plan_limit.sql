-- Keep the first release bounded to three saved alarms per user.
-- The advisory lock makes concurrent inserts observe the same count.
create or replace function public.enforce_wake_plan_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  saved_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  select count(*) into saved_count
  from public.wake_plans
  where user_id = new.user_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if saved_count >= 3 then
    raise exception 'You can save up to three wake plans.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists wake_plan_limit_trigger on public.wake_plans;
create trigger wake_plan_limit_trigger
  before insert on public.wake_plans
  for each row execute procedure public.enforce_wake_plan_limit();
