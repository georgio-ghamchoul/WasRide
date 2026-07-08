import { useEffect, useState } from "react";
import { supabase, ADMIN_PHONE_SUFFIX } from "./supabase";
import Login from "./Login";
import Panel from "./Panel";

type AuthStatus = "loading" | "signed-out" | "checking" | "admin" | "not-admin";

export default function App() {
  const [status, setStatus] = useState<AuthStatus>("loading");

  async function verifyAdmin(session: any) {
    const user = session?.user;
    if (!user) { setStatus("signed-out"); return; }
    setStatus("checking");

    // Admin is identified by phone suffix (same rule as the mobile app).
    const phone = (user.phone || "").replace(/\D/g, "");
    const phoneOk = phone.endsWith(ADMIN_PHONE_SUFFIX);

    // RLS admin power comes from profiles.role = 'admin'. Confirm it too.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const roleOk = profile?.role === "admin";

    if (phoneOk || roleOk) setStatus("admin");
    else setStatus("not-admin");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => verifyAdmin(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      verifyAdmin(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (status === "loading" || status === "checking") {
    return <div className="login-wrap"><p className="page-sub">Loading…</p></div>;
  }

  if (status === "admin") return <Panel />;

  if (status === "not-admin") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 className="login-logo">⛔ Access denied</h1>
          <p className="login-sub">This account is not an administrator.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return <Login />;
}
