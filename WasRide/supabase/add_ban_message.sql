-- Store the admin's custom message shown to a banned driver.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ban_message text;
NOTIFY pgrst, 'reload schema';
