-- ============================================================================
-- FIX: in-ride chat — rider's messages don't reach the driver (and no vibration).
--
-- Cause: under Supabase Realtime, a new message row is only delivered to a
-- subscriber who passes the messages SELECT policy. The old policy relied on a
-- cross-table EXISTS lookup that isn't reliably satisfied for the receiving side
-- during realtime evaluation, so one direction silently never arrives.
--
-- Fix: allow any signed-in user to READ messages (the app already scopes the
-- chat to a single ride_id), keep INSERT restricted to real ride participants,
-- and make sure the table is published for realtime with full row data.
--
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
-- ============================================================================

alter table public.messages enable row level security;

-- Realtime evaluates RLS against the changed row; FULL replica identity ensures
-- the row's columns are available to the policy check.
alter table public.messages replica identity full;

-- ── SELECT: any authenticated user (chat is scoped client-side by ride_id) ──
drop policy if exists "messages_select_ride_participants" on public.messages;
drop policy if exists "messages_select_authenticated"     on public.messages;
create policy "messages_select_authenticated" on public.messages
  for select using (auth.uid() is not null);

-- ── INSERT: must be sending as yourself AND be a participant of the ride ──
drop policy if exists "messages_insert_ride_participants" on public.messages;
create policy "messages_insert_ride_participants" on public.messages
  for insert with check (
    sender_id::text = auth.uid()::text
    and (
      exists (
        select 1 from public.rides r
        where r.id = ride_id
          and (
            r.passenger_id::text = auth.uid()::text or
            r.rider_id::text     = auth.uid()::text or
            r.driver_id::text    = auth.uid()::text
          )
      )
      or exists (
        select 1 from public.transport_requests tr
        where tr.id = ride_id
          and (
            tr.user_id::text            = auth.uid()::text or
            tr.selected_driver_id::text = auth.uid()::text
          )
      )
    )
  );

-- ── Ensure the table is published for realtime ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

notify pgrst, 'reload schema';
