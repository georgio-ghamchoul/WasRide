-- Allows admins to delete rides (needed for the admin panel "Clear" button to persist).
-- Run this once in the Supabase SQL editor.

drop policy if exists "rides_delete_admin" on public.rides;

create policy "rides_delete_admin" on public.rides
  for delete using (public.is_admin());
