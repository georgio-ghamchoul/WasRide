-- Security fix (#3): stop exposing every user's phone number and driver's
-- license number to any logged-in user.
--
-- Strategy:
--   1. A "public_profiles" view with ONLY non-sensitive columns, used by the app
--      for browsing/discovery (driver lists, nearby drivers, ratings, etc.).
--   2. Lock the base "profiles" table SELECT down to: your own row, your ride
--      counterpart, or an admin. So phone + license are no longer world-readable.
-- Run once in the Supabase SQL editor.

-- 1) Discovery view — safe columns only (NO phone, NO license_number, NO push token).
--    security_invoker = off so it returns these safe columns for all rows.
create or replace view public.public_profiles
with (security_invoker = off) as
  select
    id, full_name, vehicle_type, role, approval_status,
    average_rating, trips_completed, created_at
  from public.profiles;

grant select on public.public_profiles to authenticated;

-- 2) Restrict the base table. Replace the old "any authenticated user" SELECT.
drop policy if exists "profiles_select_authenticated" on public.profiles;

create policy "profiles_select_self_counterpart_admin" on public.profiles
  for select using (
    id::text = auth.uid()::text
    or public.is_admin()
    or exists (
      select 1 from public.rides r
      where (auth.uid()::text in (r.passenger_id::text, r.rider_id::text)
               and r.driver_id::text = profiles.id::text)
         or (r.driver_id::text = auth.uid()::text
               and profiles.id::text in (r.passenger_id::text, r.rider_id::text))
    )
  );
