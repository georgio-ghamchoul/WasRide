-- Driver's license number on profiles. Run once in the Supabase SQL editor.
alter table public.profiles
  add column if not exists license_number text;
