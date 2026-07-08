-- Allow 'suspended' as an approval_status (used by the Ban button).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_approval_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended'));
NOTIFY pgrst, 'reload schema';
