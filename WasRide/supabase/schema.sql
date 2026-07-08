create extension if not exists "pgcrypto";

-- ─── PROFILES ────────────────────────────────────────────────────────────────
-- is_admin() is defined AFTER profiles so the table exists when the function is validated
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  role text not null default 'rider' check (role in ('rider', 'driver', 'admin')),
  first_name text,
  last_name text,
  full_name text,
  vehicle_type text,
  vehicle_label text,
  approval_status text not null default 'approved' check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  average_rating numeric(3,2) not null default 5.0,
  trips_completed integer not null default 0,
  locale text not null default 'en' check (locale in ('en', 'ar')),
  earnings_cleared_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists earnings_cleared_at timestamptz;
alter table public.profiles add column if not exists expo_push_token text;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id::text = auth.uid()::text and role = 'admin'
  );
$$;

-- ─── TRANSPORT REQUESTS ───────────────────────────────────────────────────────
create table if not exists public.transport_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  service_type text not null check (service_type in ('ride', 'delivery')),
  delivery_kind text check (delivery_kind in ('from-home', 'from-store')),
  pickup_label text not null,
  destination_label text not null,
  description text,
  receiver_phone text,
  status text not null default 'matching' check (status in ('matching', 'driver-selected', 'tracking', 'completed', 'cancelled')),
  selected_driver_id uuid references public.profiles(id) on delete set null,
  interested_driver_ids uuid[] not null default '{}',
  pickup_latitude double precision,
  pickup_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision,
  rider_latitude double precision,
  rider_longitude double precision,
  rider_rating integer check (rider_rating between 1 and 5),
  rider_feedback text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ─── DRIVER PRESENCE ─────────────────────────────────────────────────────────
create table if not exists public.driver_presence (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  latitude double precision,
  longitude double precision,
  heading double precision,
  vehicle_label text,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ─── MESSAGES ────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.transport_requests(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) <= 500),
  created_at timestamptz not null default timezone('utc', now())
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.transport_requests enable row level security;
alter table public.driver_presence enable row level security;
alter table public.messages enable row level security;

-- Drop all existing policies in one shot
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Profiles
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.uid() is not null);
create policy "profiles_insert_own" on public.profiles
  for insert with check (id::text = auth.uid()::text or public.is_admin());
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (id::text = auth.uid()::text or public.is_admin())
  with check (id::text = auth.uid()::text or public.is_admin());

-- Transport requests
create policy "requests_select_related_or_admin" on public.transport_requests
  for select using (
    user_id::text = auth.uid()::text or
    selected_driver_id::text = auth.uid()::text or
    public.is_admin()
  );
create policy "requests_insert_own" on public.transport_requests
  for insert with check (user_id::text = auth.uid()::text or public.is_admin());
create policy "requests_update_related_or_admin" on public.transport_requests
  for update
  using (user_id::text = auth.uid()::text or selected_driver_id::text = auth.uid()::text or public.is_admin())
  with check (user_id::text = auth.uid()::text or selected_driver_id::text = auth.uid()::text or public.is_admin());

-- Driver presence
create policy "presence_select_all" on public.driver_presence
  for select using (true);
create policy "presence_insert_own_or_admin" on public.driver_presence
  for insert with check (driver_id::text = auth.uid()::text or public.is_admin());
create policy "presence_update_own_or_admin" on public.driver_presence
  for update using (driver_id::text = auth.uid()::text or public.is_admin())
  with check (driver_id::text = auth.uid()::text or public.is_admin());

-- Messages
create policy "messages_select_ride_participants" on public.messages
  for select using (
    exists (
      select 1 from public.transport_requests tr
      where tr.id = ride_id
        and (
          tr.user_id::text = auth.uid()::text or
          tr.selected_driver_id::text = auth.uid()::text or
          public.is_admin()
        )
    )
  );
create policy "messages_insert_ride_participants" on public.messages
  for insert with check (
    sender_id::text = auth.uid()::text
    and exists (
      select 1 from public.transport_requests tr
      where tr.id = ride_id
        and (tr.user_id::text = auth.uid()::text or tr.selected_driver_id::text = auth.uid()::text)
    )
  );

-- ─── RIDES ───────────────────────────────────────────────────────────────────
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid references auth.users(id) on delete set null,
  rider_id uuid references auth.users(id) on delete set null,
  driver_id uuid references public.profiles(id) on delete set null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  price integer,
  note text,
  service text,
  status text not null default 'searching',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.rides enable row level security;

drop policy if exists "rides_select_participant_or_admin" on public.rides;
drop policy if exists "rides_insert_own"                  on public.rides;
drop policy if exists "rides_update_participant_or_admin" on public.rides;
drop policy if exists "rides_delete_admin"                on public.rides;

create policy "rides_select_participant_or_admin" on public.rides
  for select using (
    passenger_id::text = auth.uid()::text or
    rider_id::text = auth.uid()::text or
    driver_id::text = auth.uid()::text or
    public.is_admin()
  );

create policy "rides_insert_own" on public.rides
  for insert with check (passenger_id::text = auth.uid()::text or public.is_admin());

create policy "rides_update_participant_or_admin" on public.rides
  for update using (
    passenger_id::text = auth.uid()::text or
    rider_id::text = auth.uid()::text or
    driver_id::text = auth.uid()::text or
    public.is_admin()
  );

create policy "rides_delete_admin" on public.rides
  for delete using (public.is_admin());

-- ─── REALTIME ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.messages;
