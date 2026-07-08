-- ============================================================
-- Run this in your Supabase dashboard → SQL Editor
-- Fixes: admin panel shows "no rides found" for all filters
-- ============================================================

-- 1. Allow admin users to SELECT all rows from the rides table
--    (without this, RLS only shows a user their own rides)
CREATE POLICY "admin_read_all_rides"
ON public.rides
FOR SELECT
TO authenticated
USING (
  passenger_id = auth.uid()
  OR driver_id  = auth.uid()
  OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 2. Allow admin users to SELECT all rows from ride_requests
CREATE POLICY "admin_read_all_ride_requests"
ON public.ride_requests
FOR SELECT
TO authenticated
USING (
  driver_id = auth.uid()
  OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 3. Allow admin users to SELECT all driver_presence rows
--    (needed for "Drivers Online" dashboard stat)
CREATE POLICY "admin_read_all_driver_presence"
ON public.driver_presence
FOR SELECT
TO authenticated
USING (
  driver_id = auth.uid()
  OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- ============================================================
-- If you get "policy already exists" errors, drop the old ones
-- first then re-run, e.g.:
--   DROP POLICY IF EXISTS "admin_read_all_rides" ON public.rides;
-- ============================================================
