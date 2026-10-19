create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  timezone text not null default 'UTC',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Trusted circle' check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'member' check (role = 'member'),
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'revoked')),
  invited_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  unique (circle_id, user_id)
);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'completed', 'archived')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_at is null or ends_at >= starts_at),
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create table public.wake_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  commitment_id uuid references public.commitments(id) on delete set null,
  circle_id uuid references public.circles(id) on delete set null,
  schedule_type text not null default 'once' check (schedule_type in ('once', 'daily', 'weekly')),
  scheduled_date date,
  local_time time not null,
  timezone text not null default 'UTC',
  weekdays smallint[] not null default '{}',
  difficulty text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  grace_period_minutes integer not null default 10 check (grace_period_minutes between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((schedule_type = 'once' and scheduled_date is not null) or schedule_type <> 'once'),
  check ((schedule_type = 'weekly' and cardinality(weekdays) > 0) or schedule_type <> 'weekly'),
  check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

create table public.wake_occurrences (
  id uuid primary key default gen_random_uuid(),
  wake_plan_id uuid not null references public.wake_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  commitment_id uuid references public.commitments(id) on delete set null,
  scheduled_for timestamptz not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  grace_period_minutes integer not null check (grace_period_minutes between 1 and 60),
  challenge_payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'ringing', 'confirmed', 'missed', 'escalated', 'cancelled')),
  triggered_at timestamptz,
  confirmed_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (wake_plan_id, scheduled_for)
);

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  device_name text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.profiles(id) on delete cascade,
  participant_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  check (participant_a <> participant_b)
);

create unique index chat_threads_unique_pair
on public.chat_threads (least(participant_a, participant_b), greatest(participant_a, participant_b));

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text', 'voice')),
  body text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((message_type = 'text' and char_length(trim(coalesce(body, ''))) between 1 and 4000) or message_type = 'voice')
);

create table public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  storage_path text not null unique,
  duration_seconds integer not null check (duration_seconds between 1 and 30),
  expires_at timestamptz not null default timezone('utc', now()) + interval '7 days',
  created_at timestamptz not null default timezone('utc', now())
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.wake_occurrences(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null default 'push' check (channel = 'push'),
  notification_type text not null default 'missed_wake' check (notification_type = 'missed_wake'),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_ticket_id text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (occurrence_id, recipient_user_id, channel)
);

create index commitments_user_start_idx on public.commitments(user_id, starts_at);
create index wake_plans_user_active_idx on public.wake_plans(user_id, is_active);
create index wake_occurrences_due_idx on public.wake_occurrences(status, scheduled_for);
create index circle_members_user_status_idx on public.circle_members(user_id, status);
create index messages_thread_created_idx on public.messages(thread_id, created_at);
create index notification_deliveries_occurrence_idx on public.notification_deliveries(occurrence_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, timezone)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_circle_participant(p_circle_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.circles c where c.id = p_circle_id and c.owner_id = p_user_id
  ) or exists (
    select 1 from public.circle_members cm
    where cm.circle_id = p_circle_id and cm.user_id = p_user_id and cm.status = 'active'
  );
$$;

create or replace function public.is_thread_participant(p_thread_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_threads t
    where t.id = p_thread_id and p_user_id in (t.participant_a, t.participant_b)
  );
$$;

create or replace function public.enforce_circle_member_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if new.status = 'active' then
    select count(*) into active_count
    from public.circle_members cm
    where cm.circle_id = new.circle_id
      and cm.status = 'active'
      and cm.id <> coalesce(new.id, gen_random_uuid());
    if active_count >= 3 then
      raise exception 'A trusted circle may have at most three active members';
    end if;
  end if;
  return new;
end;
$$;

create trigger circle_member_limit_trigger
  before insert or update of circle_id, status on public.circle_members
  for each row execute procedure public.enforce_circle_member_limit();

create or replace function public.enforce_circle_member_mutation()
returns trigger
language plpgsql
as $$
declare
  circle_owner uuid;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  select owner_id into circle_owner from public.circles where id = old.circle_id;
  if auth.uid() <> circle_owner then
    if old.user_id <> auth.uid()
      or new.circle_id <> old.circle_id
      or new.user_id <> old.user_id
      or new.role <> old.role
      or new.invited_by <> old.invited_by
      or new.invited_email <> old.invited_email
      or old.status <> 'pending'
      or new.status not in ('active', 'declined') then
      raise exception 'Only the circle owner may manage this invitation';
    end if;
    new.responded_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

create trigger circle_member_mutation_trigger
  before update on public.circle_members
  for each row execute procedure public.enforce_circle_member_mutation();

create or replace function public.validate_wake_plan_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.commitment_id is not null and not exists (
    select 1 from public.commitments c where c.id = new.commitment_id and c.user_id = new.user_id
  ) then
    raise exception 'The commitment must belong to the wake-plan owner';
  end if;
  if new.circle_id is not null and not exists (
    select 1 from public.circles c where c.id = new.circle_id and c.owner_id = new.user_id
  ) then
    raise exception 'The trusted circle must belong to the wake-plan owner';
  end if;
  return new;
end;
$$;

create trigger wake_plan_ownership_trigger
  before insert or update on public.wake_plans
  for each row execute procedure public.validate_wake_plan_ownership();

create or replace function public.validate_wake_occurrence_owner()
returns trigger
language plpgsql
as $$
declare
  plan_owner uuid;
begin
  select user_id into plan_owner from public.wake_plans where id = new.wake_plan_id;
  if plan_owner is null or plan_owner <> new.user_id then
    raise exception 'The wake occurrence owner must match the wake plan owner';
  end if;
  return new;
end;
$$;

create trigger wake_occurrence_owner_trigger
  before insert or update on public.wake_occurrences
  for each row execute procedure public.validate_wake_occurrence_owner();

create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger circles_updated_at before update on public.circles for each row execute procedure public.set_updated_at();
create trigger commitments_updated_at before update on public.commitments for each row execute procedure public.set_updated_at();
create trigger wake_plans_updated_at before update on public.wake_plans for each row execute procedure public.set_updated_at();
create trigger wake_occurrences_updated_at before update on public.wake_occurrences for each row execute procedure public.set_updated_at();
create trigger device_tokens_updated_at before update on public.device_tokens for each row execute procedure public.set_updated_at();
create trigger messages_updated_at before update on public.messages for each row execute procedure public.set_updated_at();
create trigger notification_deliveries_updated_at before update on public.notification_deliveries for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.commitments enable row level security;
alter table public.wake_plans enable row level security;
alter table public.wake_occurrences enable row level security;
alter table public.device_tokens enable row level security;
alter table public.chat_threads enable row level security;
alter table public.messages enable row level security;
alter table public.voice_notes enable row level security;
alter table public.notification_deliveries enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.circles c
    join public.circle_members cm on cm.circle_id = c.id
    where c.owner_id = auth.uid() and cm.user_id = profiles.id and cm.status = 'active'
  )
  or exists (
    select 1 from public.circles c
    where c.owner_id = profiles.id and public.is_circle_participant(c.id, auth.uid())
  )
);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy circles_owner_all on public.circles for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy circles_member_select on public.circles for select to authenticated using (public.is_circle_participant(id, auth.uid()));

create policy circle_members_owner_all on public.circle_members for all to authenticated
  using (exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid()));
create policy circle_members_invitee_select on public.circle_members for select to authenticated using (user_id = auth.uid());
create policy circle_members_invitee_update on public.circle_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy commitments_owner_all on public.commitments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy wake_plans_owner_all on public.wake_plans for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wake_plans_circle_select on public.wake_plans for select to authenticated using (circle_id is not null and public.is_circle_participant(circle_id, auth.uid()));

create policy wake_occurrences_owner_all on public.wake_occurrences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wake_occurrences_circle_select on public.wake_occurrences for select to authenticated using (
  exists (select 1 from public.wake_plans wp where wp.id = wake_plan_id and wp.circle_id is not null and public.is_circle_participant(wp.circle_id, auth.uid()))
);

create policy device_tokens_owner_all on public.device_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy chat_threads_participant_select on public.chat_threads for select to authenticated using (auth.uid() in (participant_a, participant_b));
create policy chat_threads_participant_insert on public.chat_threads for insert to authenticated with check (auth.uid() in (participant_a, participant_b));

create policy messages_participant_select on public.messages for select to authenticated using (public.is_thread_participant(thread_id, auth.uid()));
create policy messages_sender_insert on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_thread_participant(thread_id, auth.uid()));
create policy messages_sender_update on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create policy voice_notes_participant_select on public.voice_notes for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_thread_participant(m.thread_id, auth.uid()))
);
create policy voice_notes_sender_insert on public.voice_notes for insert to authenticated with check (
  exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid() and m.message_type = 'voice')
);
create policy voice_notes_sender_delete on public.voice_notes for delete to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
);

create policy notification_deliveries_participant_select on public.notification_deliveries for select to authenticated using (
  recipient_user_id = auth.uid()
  or exists (select 1 from public.wake_occurrences wo where wo.id = occurrence_id and wo.user_id = auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 10485760, array['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy voice_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy voice_objects_select on storage.objects for select to authenticated using (
  bucket_id = 'voice-notes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.voice_notes vn
      join public.messages m on m.id = vn.message_id
      where vn.storage_path = name and public.is_thread_participant(m.thread_id, auth.uid())
    )
  )
);
create policy voice_objects_delete on storage.objects for delete to authenticated using (
  bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text
);

alter table public.messages replica identity full;
alter table public.wake_occurrences replica identity full;
alter table public.circle_members replica identity full;
alter table public.notification_deliveries replica identity full;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.wake_occurrences;
alter publication supabase_realtime add table public.circle_members;
alter publication supabase_realtime add table public.notification_deliveries;
