import { useRef, useState } from "react";
import { supabase, ADMIN_PHONE_SUFFIX } from "./supabase";

export default function Login() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const otpRef = useRef<HTMLInputElement>(null);

  async function sendOtp() {
    const cleaned = phone.replace(/\D/g, "");
    if (!cleaned) return setError("Enter your phone number");
    if (!cleaned.endsWith(ADMIN_PHONE_SUFFIX)) {
      return setError("This panel is for the admin account only.");
    }
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: "+961" + cleaned });
    setLoading(false);
    if (error) return setError(error.message);
    setStep("otp");
    setTimeout(() => otpRef.current?.focus(), 200);
  }

  async function verifyOtp() {
    const cleaned = phone.replace(/\D/g, "");
    if (otp.length < 6) return setError("Enter the 6-digit code");
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: "+961" + cleaned,
      token: otp,
      type: "sms",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      setOtp("");
    }
    // On success the App's auth listener takes over and verifies admin role.
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-logo">🚖 Rebel Taxi</h1>
        <p className="login-sub">Admin Control Panel</p>

        {step === "phone" ? (
          <>
            <p className="field-label">Admin phone number</p>
            <div className="input-prefix">
              <span>+961</span>
              <input
                inputMode="numeric"
                placeholder="71 073 230"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                autoFocus
              />
            </div>
            <button className="btn" onClick={sendOtp} disabled={loading}>
              {loading ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <p className="field-label">Enter the 6-digit code sent by SMS</p>
            <input
              ref={otpRef}
              className="input"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
            />
            <button className="btn" onClick={verifyOtp} disabled={loading}>
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>
            <button className="btn-link" onClick={() => { setStep("phone"); setOtp(""); setError(""); }}>
              ← Change number
            </button>
          </>
        )}

        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
