-- ============================================================================
-- Fix rides.driver_id foreign key + backfill missing drivers
-- ----------------------------------------------------------------------------
-- PROBLEM: rides.driver_id references public.users, but the whole app stores
-- drivers in public.profiles. So valid driver ids (which live in profiles) are
-- rejected by the foreign key, leaving driver_id NULL on rides — which makes
-- earnings show 0 and the driver show blank in the admin panel.
--
-- FIX: repoint the foreign key to public.profiles (matching passenger handling
-- and the intended schema), then recover the missing driver_id values from the
-- ride_requests table.
--
-- Safe to run once in the Supabase SQL editor. Wrapped in a transaction.
-- ============================================================================

BEGIN;

-- 1) Drop the wrong foreign key.
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_driver_id_fkey;

-- 2) Null out any existing driver_id that isn't a real profile, so the new
--    constraint can be added cleanly (these point at deleted/invalid rows).
UPDATE public.rides
SET    driver_id = NULL
WHERE  driver_id IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rides.driver_id);

-- 3) Add the correct foreign key -> public.profiles.
ALTER TABLE public.rides
  ADD CONSTRAINT rides_driver_id_fkey
  FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 4) Backfill: recover driver from the accepted ride_request (driver must exist).
UPDATE public.rides r
SET    driver_id = rr.driver_id
FROM   public.ride_requests rr
WHERE  r.id = rr.ride_id
  AND  r.driver_id IS NULL
  AND  rr.driver_id IS NOT NULL
  AND  rr.status = 'accepted'
  AND  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rr.driver_id);

-- 5) Fallback: most recent valid request for any ride still missing a driver.
UPDATE public.rides r
SET    driver_id = sub.driver_id
FROM (
  SELECT DISTINCT ON (rr.ride_id) rr.ride_id, rr.driver_id
  FROM   public.ride_requests rr
  WHERE  rr.driver_id IS NOT NULL
    AND  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rr.driver_id)
  ORDER  BY rr.ride_id, rr.created_at DESC
) sub
WHERE  r.id = sub.ride_id
  AND  r.driver_id IS NULL;

COMMIT;

-- Verify (run after): should be 0 for completed rides in most cases.
-- SELECT count(*) FROM rides WHERE status='completed' AND driver_id IS NULL;
