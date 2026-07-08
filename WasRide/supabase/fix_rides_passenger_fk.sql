-- ============================================================================
-- Fix rides.passenger_id foreign key
-- ----------------------------------------------------------------------------
-- PROBLEM: rides.passenger_id references public.users, but the app stores all
-- riders in public.profiles. So when a rider creates a ride, the insert fails
-- with: "violates foreign key constraint rides_passenger_id_fkey".
--
-- FIX: repoint the foreign key to public.profiles (same fix already applied to
-- driver_id). Safe to run once in the Supabase SQL editor. Wrapped in a
-- transaction.
-- ============================================================================

BEGIN;

-- 1) Drop the wrong foreign key.
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_passenger_id_fkey;

-- 2) passenger_id is NOT NULL, so we can't null bad rows (that rolls back the
--    whole migration). Delete orphan rides whose passenger isn't a real profile.
DELETE FROM public.rides
WHERE  passenger_id IS NULL
   OR  NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rides.passenger_id);

-- 3) Add the correct foreign key -> public.profiles.
ALTER TABLE public.rides
  ADD CONSTRAINT rides_passenger_id_fkey
  FOREIGN KEY (passenger_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 4) Some installs also have a rider_id column with the same broken FK. Fix it
--    too if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'rider_id'
  ) THEN
    ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_rider_id_fkey;
    UPDATE public.rides
    SET    rider_id = NULL
    WHERE  rider_id IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rides.rider_id);
    ALTER TABLE public.rides
      ADD CONSTRAINT rides_rider_id_fkey
      FOREIGN KEY (rider_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- Refresh PostgREST so the change is visible immediately.
NOTIFY pgrst, 'reload schema';
