-- Security fix: tighten the admin check.
-- The old rule used `like '%71073230'`, which matches ANY phone number ending
-- in those 8 digits (e.g. a foreign number) — a privilege-escalation risk.
-- This requires the EXACT full number, and still allows profiles.role = 'admin'.
-- Run once in the Supabase SQL editor.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g') = '96171073230',
      false
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    );
$$;
