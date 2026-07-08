-- Rider cancel-limit tracking + cancellation reasons.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cancel_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cancel_lock_until timestamptz;
ALTER TABLE public.rides    ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.rides    ADD COLUMN IF NOT EXISTS cancelled_by text; -- 'rider' | 'driver'
NOTIFY pgrst, 'reload schema';
