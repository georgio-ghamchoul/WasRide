-- ─── FIX: messages RLS — rider can't send or read chat messages ─────────────
--
-- Root cause: the old policies checked public.transport_requests (tr.id = ride_id)
-- but ride_id in the messages table is a rides.id UUID, not a transport_requests UUID.
-- So the EXISTS subquery never matched for riders, blocking all their inserts/selects.
--
-- Fix: replace both policies to check the rides table directly using
-- passenger_id / rider_id (rider side) or driver_id (driver side).
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).

-- ── 1. SELECT ────────────────────────────────────────────────────────────────
drop policy if exists "messages_select_ride_participants" on public.messages;

create policy "messages_select_ride_participants" on public.messages
  for select using (
    -- sender can always read their own messages
    sender_id::text = auth.uid()::text
    or exists (
      select 1 from public.rides r
      where r.id = ride_id
        and (
          r.passenger_id::text = auth.uid()::text or
          r.rider_id::text     = auth.uid()::text or
          r.driver_id::text    = auth.uid()::text or
          public.is_admin()
        )
    )
  );

-- ── 2. INSERT ────────────────────────────────────────────────────────────────
drop policy if exists "messages_insert_ride_participants" on public.messages;

create policy "messages_insert_ride_participants" on public.messages
  for insert with check (
    -- must be sending as yourself
    sender_id::text = auth.uid()::text
    and exists (
      select 1 from public.rides r
      where r.id = ride_id
        and (
          r.passenger_id::text = auth.uid()::text or
          r.rider_id::text     = auth.uid()::text or
          r.driver_id::text    = auth.uid()::text
        )
    )
  );
