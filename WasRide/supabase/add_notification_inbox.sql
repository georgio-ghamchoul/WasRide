-- ============================================================================
-- Notification inbox — run once in the Supabase SQL editor. Safe to re-run.
-- Extends the existing public.notifications table into a per-user inbox.
-- ============================================================================

-- 1) Targeted recipient (NULL = broadcast to the audience) + a type for icons.
alter table public.notifications add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists type text not null default 'admin';

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);

-- 2) Per-user "last read" marker drives the unread badge.
alter table public.profiles add column if not exists notifications_read_at timestamptz;

-- 3) RLS: a user sees broadcasts (user_id IS NULL) + their own targeted rows.
drop policy if exists "notifications_select_all"   on public.notifications;
drop policy if exists "notifications_select_own"   on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (
    user_id is null
    or user_id = auth.uid()
    or public.is_admin()
  );

-- 4) Any signed-in user may insert (needed for ride-event + chat notifications).
--    Admins keep inserting broadcasts; this just widens it to authenticated users.
drop policy if exists "notifications_insert_admin" on public.notifications;
drop policy if exists "notifications_insert_auth"  on public.notifications;
create policy "notifications_insert_auth" on public.notifications
  for insert with check (auth.uid() is not null);

notify pgrst, 'reload schema';
