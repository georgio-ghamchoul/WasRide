-- =====================================================================
-- Tighten RLS on public.notifications
-- ---------------------------------------------------------------------
-- Problem: the old INSERT policy was `with check (auth.uid() is not null)`,
-- meaning ANY signed-in user could insert ANY notification — including
-- broadcasts to every rider/driver, or fake "Account Banned" / admin rows
-- aimed at other people.
--
-- Goal:
--   * Admins may insert anything (broadcasts, ban, admin DMs, targeted).
--   * Normal users may ONLY insert TARGETED rows (user_id set) of the
--     harmless app-generated kinds: 'ride', 'chat', 'system'.
--     -> covers driver/trip ride-events and chat message notifications.
--   * Normal users may NOT insert broadcasts (user_id IS NULL) or any
--     'admin' / 'ban' rows.
--
-- Admin is recognized two ways (either is enough):
--   1. Phone ends in 71073230  (same rule the app uses everywhere)
--   2. profiles.role = 'admin'  (future-proof for multiple admins)
-- =====================================================================

-- Make sure the columns this policy depends on exist (safe to re-run).
-- These normally come from add_notification_inbox.sql; included here so this
-- script works standalone even if that migration wasn't fully applied.
alter table public.notifications add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists type text not null default 'admin';
alter table public.notifications add column if not exists audience text not null default 'all';
alter table public.profiles      add column if not exists notifications_read_at timestamptz;

-- Helper: is the current caller an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      -- phone-suffix rule (strip non-digits from the JWT phone claim)
      regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g') like '%71073230',
      false
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    );
$$;

alter table public.notifications enable row level security;

-- Replace any prior insert policy.
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "Allow authenticated insert" on public.notifications;

create policy "notifications_insert"
on public.notifications
for insert
to authenticated
with check (
  public.is_admin()
  or (
    -- non-admins: targeted rows only, and only safe types
    user_id is not null
    and type in ('ride', 'chat', 'system')
  )
);

-- (Optional, recommended) SELECT policy: users see broadcasts + their own
-- targeted rows; admins see everything. Adjust/skip if you already have one.
drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select"
on public.notifications
for select
to authenticated
using (
  public.is_admin()
  or user_id is null            -- broadcasts (audience filtered client-side)
  or user_id = auth.uid()       -- this user's targeted rows
);

notify pgrst, 'reload schema';
