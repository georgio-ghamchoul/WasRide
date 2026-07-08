// Edge Function: verify-otp
// Validates the WhatsApp OTP with Message Central (Verify Now). On success,
// sets a fresh one-time password on the user (creating them if needed) and
// returns it; the client then signs in with signInWithPassword({ phone, password }).
// Deploy with verify_jwt = false.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  try {
    const { phone, code } = await req.json();
    if (!phone || !/^\+961\d{8}$/.test(phone) || !code || !/^\d{4,8}$/.test(String(code))) {
      return json({ message: "Invalid request" }, 400);
    }
    const mobileNumber = phone.replace(/^\+961/, "");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: row } = await admin
      .from("otp_codes").select("*").eq("phone", phone).maybeSingle();
    if (!row) return json({ message: "No code was requested for this number" }, 400);
    if (new Date(row.expires_at) < new Date()) {
      await admin.from("otp_codes").delete().eq("phone", phone);
      return json({ message: "The code has expired. Request a new one." }, 400);
    }

    const verificationId = row.code_hash; // stored by send-otp
    const customerId = Deno.env.get("MC_CUSTOMER_ID");
    const authToken = Deno.env.get("MC_AUTH_TOKEN");

    // Validate the code with Message Central.
    const url =
      `https://cpaas.messagecentral.com/verification/v3/validateOtp` +
      `?countryCode=961&mobileNumber=${mobileNumber}&verificationId=${verificationId}` +
      `&customerId=${customerId}&code=${encodeURIComponent(String(code))}`;
    const res = await fetch(url, { method: "GET", headers: { authToken: authToken ?? "" } });
    const body = await res.json().catch(() => ({}));

    const status = body?.data?.verificationStatus;
    if (!res.ok || status !== "VERIFICATION_COMPLETED") {
      console.error("MC validate", res.status, JSON.stringify(body));
      return json({ message: "Incorrect or expired code" }, 400);
    }

    // Code is valid. Mint a long one-time password and attach it to the user.
    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;

    const { data: existingId } = await admin.rpc("get_user_id_by_phone", { p_phone: phone });
    let userId = (existingId as string | null) ?? null;

    if (!userId) {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        phone, password, phone_confirm: true,
      });
      if (cErr || !created?.user) {
        console.error("createUser error", cErr);
        return json({ message: "Could not sign you in. Please try again." }, 500);
      }
      userId = created.user.id;
    } else {
      const { error: uErr } = await admin.auth.admin.updateUserById(userId, {
        password, phone_confirm: true,
      });
      if (uErr) {
        console.error("updateUserById error", uErr);
        return json({ message: "Could not sign you in. Please try again." }, 500);
      }
    }

    await admin.from("otp_codes").delete().eq("phone", phone);
    return json({ password });
  } catch (e) {
    console.error("verify-otp error", e);
    return json({ message: "Server error" }, 500);
  }
});
