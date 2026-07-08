-- WhatsApp OTP via SendZen — backend setup.
-- Run this once in the Supabase SQL editor.

-- Stores the short-lived hashed OTP per phone number.
create table if not exists public.otp_codes (
  phone       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

-- Lock it down: no anon/authenticated access. Only the service role
-- (used by the Edge Functions) can read/write it. RLS on + no policies = deny all.
alter table public.otp_codes enable row level security;

-- Helper so the verify function can find an existing auth user by phone.
-- auth.users stores the phone without a leading '+', so match both forms.
create or replace function public.get_user_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = auth, public
as $$
  select id from auth.users
  where phone = p_phone or phone = ltrim(p_phone, '+')
  limit 1;
$$;

revoke all on function public.get_user_id_by_phone(text) from anon, authenticated;
