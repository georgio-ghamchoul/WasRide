// Client helper for the custom WhatsApp OTP flow (SendZen + Supabase Edge Functions).
// Replaces supabase.auth.signInWithOtp / verifyOtp.
import { supabase } from "./supabase";

// Request a WhatsApp code. `phone` must be E.164, e.g. "+9617XXXXXXX".
export async function sendWhatsappOtp(phone: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("send-otp", { body: { phone } });
  if (error) {
    // supabase.functions returns the function's JSON in error.context for non-2xx
    const msg = await readFnError(error);
    throw new Error(msg || "Could not send the code. Please try again.");
  }
  if (data && data.ok === false) throw new Error(data.message || "Could not send the code.");
}

// Verify the code and establish a real Supabase session.
export async function verifyWhatsappOtp(phone: string, code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("verify-otp", { body: { phone, code } });
  if (error) {
    const msg = await readFnError(error);
    throw new Error(msg || "Incorrect or expired code.");
  }
  if (!data?.password) throw new Error(data?.message || "Incorrect or expired code.");

  // Bridge: sign in with the one-time password the function just set.
  const { error: signErr } = await supabase.auth.signInWithPassword({ phone, password: data.password });
  if (signErr) throw signErr;
}

// Extract a human-readable message from a Functions error response.
async function readFnError(error: any): Promise<string | null> {
  try {
    const res = error?.context;
    if (res && typeof res.json === "function") {
      const body = await res.json();
      return body?.message ?? null;
    }
  } catch (_) { /* ignore */ }
  return error?.message ?? null;
}
