-- ============================================================================
-- Admin panel fixes — run this once in the Supabase SQL editor, then click Run.
-- Safe to run more than once.
-- ============================================================================

-- 1) Let admins delete rides (needed for the "Clear" button to persist).
drop policy if exists "rides_delete_admin" on public.rides;
create policy "rides_delete_admin" on public.rides
  for delete using (public.is_admin());

-- 2) When a ride is deleted, also delete its ride_requests rows.
--    Without ON DELETE CASCADE the delete fails with a foreign-key violation.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ride_requests'
  ) then
    alter table public.ride_requests
      drop constraint if exists ride_requests_ride_id_fkey;
    alter table public.ride_requests
      add constraint ride_requests_ride_id_fkey
      foreign key (ride_id) references public.rides(id) on delete cascade;
  end if;
end $$;

-- 3) Ensure the earnings_cleared_at column exists (used by "Clear earnings").
alter table public.profiles add column if not exists earnings_cleared_at timestamptz;

-- 4) Store each user's Expo push token so the admin can broadcast notifications.
alter table public.profiles add column if not exists expo_push_token text;

-- 5) In-app notifications: admin broadcasts that show up on driver/rider phones.
--    Works without push tokens (delivered via Supabase realtime), so it works in Expo Go.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text not null,
  audience text not null default 'all' check (audience in ('all', 'drivers', 'riders')),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_all"   on public.notifications;
drop policy if exists "notifications_insert_admin" on public.notifications;

-- Anyone signed in can read notifications (the app filters by audience client-side).
create policy "notifications_select_all" on public.notifications
  for select using (true);

-- Only admins may create them.
create policy "notifications_insert_admin" on public.notifications
  for insert with check (public.is_admin());

-- Deliver inserts to listening apps in real time.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 6) Refresh PostgREST's schema cache so the new columns/tables are visible immediately.
notify pgrst, 'reload schema';
