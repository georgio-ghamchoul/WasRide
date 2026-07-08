// Edge Function: send-otp
// Sends a WhatsApp OTP via Message Central (Verify Now). Message Central
// generates the code and returns a verificationId, which we store per phone
// so verify-otp can validate it. Deploy with verify_jwt = false.
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
    const { phone } = await req.json();
    // Expect E.164 Lebanon: +961 followed by 8 digits.
    if (!phone || !/^\+961\d{8}$/.test(phone)) {
      return json({ message: "Invalid phone number" }, 400);
    }
    const mobileNumber = phone.replace(/^\+961/, "");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit: at most one code per 45s per phone (blocks spam + cost abuse).
    const { data: recent } = await admin
      .from("otp_codes").select("created_at").eq("phone", phone).maybeSingle();
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 45_000) {
      return json({ message: "Please wait a moment before requesting another code." }, 429);
    }

    const customerId = Deno.env.get("MC_CUSTOMER_ID");
    const authToken = Deno.env.get("MC_AUTH_TOKEN");

    // Ask Message Central to send the WhatsApp OTP.
    const url =
      `https://cpaas.messagecentral.com/verification/v3/send` +
      `?countryCode=961&customerId=${customerId}&flowType=WHATSAPP&mobileNumber=${mobileNumber}`;
    const res = await fetch(url, { method: "POST", headers: { authToken: authToken ?? "" } });
    const body = await res.json().catch(() => ({}));

    const verificationId = body?.data?.verificationId;
    if (!res.ok || !verificationId) {
      console.error("MC send error", res.status, JSON.stringify(body));
      // Most failures here are the provider's short resend cooldown.
      return json({
        message: "Could not send the code. If you just requested one, please wait a minute and try again.",
      }, 502);
    }

    // Reuse otp_codes: store the Message Central verificationId in code_hash.
    const { error: upErr } = await admin.from("otp_codes").upsert({
      phone,
      code_hash: String(verificationId),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      attempts: 0,
      created_at: new Date().toISOString(),
    });
    if (upErr) {
      console.error("otp_codes upsert error", upErr);
      return json({ message: "Server error" }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("send-otp error", e);
    return json({ message: "Server error" }, 500);
  }
});
