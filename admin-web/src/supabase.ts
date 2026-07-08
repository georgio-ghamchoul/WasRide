import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// The phone number whose suffix marks the admin account (same as the mobile app).
export const ADMIN_PHONE_SUFFIX = "71073230";

// Commission rates by vehicle type (mirrors the mobile admin panel).
export const COMMISSION: Record<string, number> = {
  Motorcycle: 0.1,
  Tuktuk: 0.12,
  Car: 0.15,
};
export const DEFAULT_COMMISSION = 0.1;
