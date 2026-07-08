-- ============================================================================
-- Backfill missing driver_id on rides  (SAFE / existence-checked version)
-- ----------------------------------------------------------------------------
-- Some rides (accepted via the counter-offer flow) were saved without a
-- driver_id, so they show "no driver" and are skipped in earnings totals.
-- The driver is still recorded in ride_requests (the accepted request row).
--
-- rides.driver_id has a foreign key, so we ONLY set it to ids that actually
-- exist in the referenced tables. Rides whose recovered driver is no longer a
-- valid user/profile are left untouched (they can't be attributed to anyone).
--
-- Safe to run multiple times. Run once in the Supabase SQL editor.
-- ============================================================================

-- A driver id is only "safe" to write if it still exists as a real driver in
-- profiles (which itself references auth.users), so the foreign key is satisfied.
-- The invalid id from before (a deleted account) is skipped automatically.
--
-- 1) Recover from the accepted ride_request, only for FK-safe drivers.
UPDATE rides r
SET    driver_id = rr.driver_id
FROM   ride_requests rr
WHERE  r.id = rr.ride_id
  AND  r.driver_id IS NULL
  AND  rr.driver_id IS NOT NULL
  AND  rr.status = 'accepted'
  AND  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rr.driver_id);

-- 2) Fall back to the most recent FK-safe request for rides still missing one.
UPDATE rides r
SET    driver_id = sub.driver_id
FROM (
  SELECT DISTINCT ON (rr.ride_id) rr.ride_id, rr.driver_id
  FROM   ride_requests rr
  WHERE  rr.driver_id IS NOT NULL
    AND  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rr.driver_id)
  ORDER  BY rr.ride_id, rr.created_at DESC
) sub
WHERE  r.id = sub.ride_id
  AND  r.driver_id IS NULL;

-- ----------------------------------------------------------------------------
-- Diagnostics — run these SELECTs to see the result:
--
--   -- how many completed rides still have no driver (best case: 0)
--   SELECT count(*) FROM rides WHERE status = 'completed' AND driver_id IS NULL;
--
--   -- the driver ids referenced by requests that are NOT valid users
--   -- (these are why some rides can't be backfilled)
--   SELECT DISTINCT rr.driver_id
--   FROM   ride_requests rr
--   WHERE  rr.driver_id IS NOT NULL
--     AND  NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = rr.driver_id);
-- ============================================================================
