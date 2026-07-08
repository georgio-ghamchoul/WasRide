-- Ensures the column that drives the unread badge exists. Without it, "mark as
-- read" fails silently and the notification dot never clears.
-- Run once in the Supabase SQL editor (safe to run even if it already exists).
alter table public.profiles
  add column if not exists notifications_read_at timestamptz;
