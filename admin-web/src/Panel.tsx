import { useEffect, useState } from "react";
import { supabase, COMMISSION, DEFAULT_COMMISSION } from "./supabase";

type Tab = "dashboard" | "drivers" | "rides" | "earnings" | "notify";
type DriverFilter = "pending" | "approved" | "suspended" | "rejected" | "all";
type RideFilter = "active" | "completed" | "cancelled";
type Audience = "all" | "drivers" | "riders";

const ACTIVE_STATUSES = ["searching", "accepted", "tracking", "counter_offer"];
const fmt = (n: number) => Number(n || 0).toLocaleString();

// Build and download a CSV file from an array of objects.
function downloadCSV(filename: string, rows: any[], columns: { key: string; label: string }[]) {
  if (!rows.length) return;
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const tsLabel = (c: string) =>
  new Date(/[Z+]/.test(c) ? c : c + "Z").toLocaleString();

function vehicleIcon(v?: string) {
  const t = (v || "").toLowerCase();
  if (t.includes("moto")) return "🏍️";
  if (t.includes("tuk")) return "🛺";
  if (t.includes("van") || t.includes("bus")) return "🚐";
  if (t.includes("truck")) return "🚚";
  return "🚗";
}

export default function Panel() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [toast, setToast] = useState("");
  const [stats, setStats] = useState({
    pendingDrivers: 0, driversOnline: 0, activeRides: 0,
    completedRides: 0, cancelledRides: 0, totalUsers: 0,
    todayRevenue: 0, weekRevenue: 0, allTimeRevenue: 0,
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  // ---- Dashboard stats (also feeds the Drivers badge) ----
  async function loadStats() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 86400000);
    const activeCutoff = new Date(Date.now() - 6 * 3600000).toISOString();
    const [
      { count: pending }, { count: online }, { count: active },
      { count: completed }, { count: cancelled }, { count: users },
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "driver").eq("approval_status", "pending"),
      supabase.from("driver_presence").select("driver_id", { count: "exact", head: true }).eq("is_online", true),
      supabase.from("rides").select("id", { count: "exact", head: true }).in("status", ACTIVE_STATUSES).gte("created_at", activeCutoff),
      supabase.from("rides").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("rides").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "rider"),
    ]);

    // All revenue cards (today / week / all-time) exclude rides that fall before
    // each driver's earnings_cleared_at, so the Clear button zeroes all three.
    const tsP = (c: string) => {
      if (!c) return new Date(NaN);
      let s = c.trim().replace(" ", "T");
      s = s.replace(/([+-]\d{2})$/, "$1:00");
      if (!/[Z]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
      return new Date(s);
    };
    const [allRidesRes, clearProfRes] = await Promise.all([
      supabase.from("rides").select("driver_id, price, created_at").eq("status", "completed").limit(5000),
      supabase.from("profiles").select("id, earnings_cleared_at").eq("role", "driver"),
    ]);
    const clearedAt = new Map<string, number>();
    (clearProfRes.data || []).forEach((d: any) => {
      if (d.earnings_cleared_at) clearedAt.set(d.id, tsP(d.earnings_cleared_at).getTime());
    });
    // A ride still counts unless it's before that driver's clear timestamp.
    const counts = (r: any) => {
      const cut = r.driver_id ? clearedAt.get(r.driver_id) : undefined;
      return !(cut !== undefined && tsP(r.created_at).getTime() <= cut);
    };
    const allRides = allRidesRes.data || [];
    const allTimeRevenue = allRides.reduce((s: number, r: any) => counts(r) ? s + (Number(r.price) || 0) : s, 0);
    const todayRevenue = allRides.reduce((s: number, r: any) => (counts(r) && tsP(r.created_at) >= todayStart) ? s + (Number(r.price) || 0) : s, 0);
    const weekRevenue = allRides.reduce((s: number, r: any) => (counts(r) && tsP(r.created_at) >= weekStart) ? s + (Number(r.price) || 0) : s, 0);

    setStats({
      pendingDrivers: pending || 0, driversOnline: online || 0, activeRides: active || 0,
      completedRides: completed || 0, cancelledRides: cancelled || 0, totalUsers: users || 0,
      todayRevenue, weekRevenue, allTimeRevenue,
    });
  }

  useEffect(() => {
    loadStats();
    const id = setInterval(loadStats, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">🚖 Admin</div>
        <NavBtn icon="📊" label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
        <NavBtn icon="🧑‍✈️" label="Drivers" active={tab === "drivers"} onClick={() => setTab("drivers")} badge={stats.pendingDrivers} />
        <NavBtn icon="🚕" label="Rides" active={tab === "rides"} onClick={() => setTab("rides")} />
        <NavBtn icon="💰" label="Earnings" active={tab === "earnings"} onClick={() => setTab("earnings")} />
        <NavBtn icon="📣" label="Notify" active={tab === "notify"} onClick={() => setTab("notify")} />
        <button className="nav-item signout" onClick={() => supabase.auth.signOut()}>
          <span>🚪</span><span className="label">Sign out</span>
        </button>
      </nav>

      <main className="main">
        {tab === "dashboard" && <Dashboard stats={stats} onChange={loadStats} showToast={showToast} />}
        {tab === "drivers" && <Drivers onChange={loadStats} showToast={showToast} />}
        {tab === "rides" && <Rides showToast={showToast} onChange={loadStats} />}
        {tab === "earnings" && <Earnings showToast={showToast} />}
        {tab === "notify" && <Notify showToast={showToast} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavBtn({ icon, label, active, onClick, badge }: any) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <span>{icon}</span>
      <span className="label">{label}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

/* ------------------------------ Dashboard ------------------------------ */
function Dashboard({ stats, onChange, showToast }: { stats: any; onChange: () => void; showToast: (m: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  async function clearFrom(mode: "all" | "week" | "today") {
    const prompts = {
      all: "Clear ALL revenue? Today, this week and all-time all go to 0.",
      week: "Clear everything older than this week? This week's revenue stays visible.",
      today: "Clear everything before today? Only today's revenue stays visible.",
    };
    if (!confirm(prompts[mode])) return;
    setMenuOpen(false);

    let cutoff: number;
    if (mode === "all") cutoff = Date.now();
    else if (mode === "week") cutoff = Date.now() - 7 * 86400000;
    else { const d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime(); }

    // Never move a driver's cutoff earlier (that would un-clear old rides).
    const { data: drivers, error: readErr } = await supabase
      .from("profiles").select("id, earnings_cleared_at").eq("role", "driver");
    if (readErr) return showToast("Error: " + readErr.message);
    if (!drivers || drivers.length === 0) return showToast("No drivers to clear.");

    let ok = 0;
    for (const d of drivers) {
      const cur = d.earnings_cleared_at ? new Date(d.earnings_cleared_at).getTime() : 0;
      const next = new Date(Math.max(cur, cutoff)).toISOString();
      const { data, error } = await supabase
        .from("profiles").update({ earnings_cleared_at: next }).eq("id", d.id).select("id");
      if (!error && data && data.length) ok++;
    }
    if (ok === 0) return showToast("Blocked by RLS — run admin_panel_fixes.sql.");
    const done = { all: "Cleared all revenue", week: "Cleared everything before this week", today: "Cleared everything before today" };
    showToast(`${done[mode]} (${ok} driver${ok > 1 ? "s" : ""})`);
    onChange();
  }
  const cards = [
    { icon: "⏳", label: "Pending drivers", value: stats.pendingDrivers, color: "var(--amber)", soft: "var(--amber-soft)" },
    { icon: "🟢", label: "Drivers online", value: stats.driversOnline, color: "var(--green)", soft: "var(--green-soft)" },
    { icon: "🚕", label: "Active rides", value: stats.activeRides, color: "var(--blue)", soft: "var(--blue-soft)" },
    { icon: "✅", label: "Completed rides", value: stats.completedRides, color: "var(--green)", soft: "var(--green-soft)" },
    { icon: "🚫", label: "Cancelled rides", value: stats.cancelledRides, color: "var(--red)", soft: "var(--red-soft)" },
    { icon: "👥", label: "Total riders", value: stats.totalUsers, color: "var(--text)", soft: "var(--card2)" },
    { icon: "☀️", label: "Today revenue (L.L)", value: fmt(stats.todayRevenue), color: "var(--gold)", soft: "var(--gold-soft)" },
    { icon: "📈", label: "This week (L.L)", value: fmt(stats.weekRevenue), color: "var(--gold)", soft: "var(--gold-soft)" },
    { icon: "🏦", label: "All-time revenue (L.L)", value: fmt(stats.allTimeRevenue), color: "var(--green)", soft: "var(--green-soft)" },
  ];
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live overview · refreshes every few seconds</p>
        </div>
        <div className="clear-menu-wrap">
          <button className="btn-sm danger-btn" onClick={() => setMenuOpen((o) => !o)}>Clear revenue ▾</button>
          {menuOpen && (
            <>
              <div className="clear-menu-overlay" onClick={() => setMenuOpen(false)} />
              <div className="clear-menu">
                <button onClick={() => clearFrom("today")}>Keep today only</button>
                <button onClick={() => clearFrom("week")}>Keep this week</button>
                <button className="danger" onClick={() => clearFrom("all")}>Clear everything</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-icon" style={{ background: c.soft, color: c.color }}>{c.icon}</div>
            <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ Drivers ------------------------------ */
function Drivers({ onChange, showToast }: { onChange: () => void; showToast: (m: string) => void }) {
  const [filter, setFilter] = useState<DriverFilter>("pending");
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    let q = supabase.from("profiles").select("*").eq("role", "driver");
    if (filter !== "all") q = q.eq("approval_status", filter);
    const { data } = await q.order("created_at", { ascending: false });
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [filter]);

  async function setStatus(id: string, status: string) {
    const update: any = { approval_status: status };
    if (status === "suspended") {
      const msg = window.prompt("Message to show the banned driver (e.g. \"Pay your fees to continue\"):", "");
      if (msg === null) return; // admin cancelled
      update.ban_message = msg.trim() || null;
    } else if (status === "approved") {
      update.ban_message = null;
    }
    const { error } = await supabase.from("profiles").update(update).eq("id", id);
    if (error) return showToast("Error: " + error.message);
    if (status === "rejected" || status === "suspended") {
      await supabase.from("driver_presence").update({ is_online: false }).eq("driver_id", id);
      await supabase.from("notifications").insert({
        user_id: id, type: "ban", title: "Account Banned",
        body: update.ban_message || "Your account has been banned. Contact support for details.",
      });
    }
    showToast("Driver updated");
    load();
    onChange();
  }

  const filtered = rows.filter((d) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return (d.full_name || "").toLowerCase().includes(s) || (d.phone || "").includes(s);
  });

  return (
    <>
      <h1 className="page-title">Drivers</h1>
      <p className="page-sub">Approve, ban or reactivate drivers</p>
      <div className="toolbar">
        <div className="filter-row" style={{ margin: 0 }}>
          {(["pending", "approved", "suspended", "all"] as DriverFilter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f === "suspended" ? "Banned" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="search" placeholder="Search name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-sm muted-btn" onClick={() => downloadCSV("drivers", filtered, [
            { key: "full_name", label: "Name" },
            { key: "phone", label: "Phone" },
            { key: "vehicle_type", label: "Vehicle" },
            { key: "approval_status", label: "Status" },
            { key: "trips_completed", label: "Trips" },
            { key: "created_at", label: "Joined" },
          ])}>⬇ CSV</button>
        </div>
      </div>

      {loading ? <p className="empty">Loading…</p> : filtered.length === 0 ? (
        <p className="empty">No drivers in this view.</p>
      ) : filtered.map((d) => (
        <div className="row-card clickable" key={d.id} onClick={() => setSelectedId(d.id)}>
          <DriverAvatar id={d.id} name={d.full_name} size={44} />
          <div className="row-main">
            <div className="row-title">{d.full_name || "Unknown"}</div>
            <div className="row-sub">{d.phone || "—"} · {vehicleIcon(d.vehicle_type)} {d.vehicle_type || "—"} · {d.trips_completed ?? 0} trips</div>
          </div>
          <StatusPill status={d.approval_status} />
          <div className="btn-row" onClick={(e) => e.stopPropagation()}>
            {d.approval_status !== "approved" && <button className="btn-sm" style={{ background: "var(--green)" }} onClick={() => setStatus(d.id, "approved")}>Approve</button>}
            {d.approval_status !== "suspended" && <button className="btn-sm danger-btn" onClick={() => setStatus(d.id, "suspended")}>Ban</button>}
          </div>
          <span className="row-chevron">›</span>
        </div>
      ))}
      {selectedId && (
        <DriverProfile
          id={selectedId}
          onClose={() => setSelectedId(null)}
          showToast={showToast}
          onChange={() => { load(); onChange(); }}
        />
      )}
    </>
  );
}

/* Photo helpers — images live in the 'driver-images' storage bucket. */
function storageUrl(path: string) {
  return supabase.storage.from("driver-images").getPublicUrl(path).data.publicUrl;
}
function driverPhotos(id: string) {
  return {
    profile: storageUrl(`drivers/${id}.jpg`),
    vehicle: storageUrl(`vehicles/${id}.jpg`),
    idFront: storageUrl(`drivers/id-front-${id}.jpg`),
    idBack: storageUrl(`drivers/id-back-${id}.jpg`),
    selfie: storageUrl(`drivers/selfie-${id}.jpg`),
    licenseFront: storageUrl(`drivers/license-front-${id}.jpg`),
    licenseBack: storageUrl(`drivers/license-back-${id}.jpg`),
  };
}

/* Round avatar that falls back to the initial if there's no photo. */
function DriverAvatar({ id, name, size = 44 }: { id: string; name?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.4 } as any;
  if (err) return <div className="d-avatar" style={style}>{initial}</div>;
  return (
    <img
      className="d-avatar-img"
      style={{ width: size, height: size }}
      src={driverPhotos(id).profile}
      alt={initial}
      onError={() => setErr(true)}
    />
  );
}

/* ------------------------------ Driver profile modal ------------------------------ */
function DriverProfile({ id, onClose, showToast, onChange }:
  { id: string; onClose: () => void; showToast: (m: string) => void; onChange: () => void }) {
  const [driver, setDriver] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ completed: 0, cancelled: 0, total: 0, commission: 0, payout: 0 });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const photos = driverPhotos(id);

  async function load() {
    setLoading(true);
    const [{ data: profile }, { data: rides }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase.from("rides").select("status, price").eq("driver_id", id).limit(1000),
    ]);
    setDriver(profile);
    const arr = rides || [];
    const completed = arr.filter((r) => r.status === "completed");
    const total = completed.reduce((s, r) => s + (Number(r.price) || 0), 0);
    const rate = COMMISSION[profile?.vehicle_type] || DEFAULT_COMMISSION;
    setStats({
      completed: completed.length,
      cancelled: arr.filter((r) => r.status === "cancelled").length,
      total,
      commission: Math.round(total * rate),
      payout: Math.round(total * (1 - rate)),
    });
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);

  async function setStatus(status: string) {
    const update: any = { approval_status: status };
    if (status === "suspended") {
      const msg = window.prompt("Message to show the banned driver (e.g. \"Pay your fees to continue\"):", "");
      if (msg === null) return; // admin cancelled
      update.ban_message = msg.trim() || null;
    } else if (status === "approved") {
      update.ban_message = null;
    }
    const { error } = await supabase.from("profiles").update(update).eq("id", id);
    if (error) return showToast("Error: " + error.message);
    if (status === "rejected" || status === "suspended") {
      await supabase.from("driver_presence").update({ is_online: false }).eq("driver_id", id);
      await supabase.from("notifications").insert({
        user_id: id, type: "ban", title: "Account Banned",
        body: update.ban_message || "Your account has been banned. Contact support for details.",
      });
    }
    showToast("Driver updated");
    load();
    onChange();
  }

  async function sendDirectMessage() {
    const body = window.prompt(`Message to send to ${driver?.full_name || "this user"} (goes to their inbox):`, "");
    if (body === null || !body.trim()) return;
    const { error } = await supabase.from("notifications").insert({
      user_id: id, type: "admin", title: "Message from Support", body: body.trim(),
    });
    if (error) return showToast("Error: " + error.message);
    showToast("Message sent");
  }

  const detailRows: [string, any][] = driver ? [
    ["Full name", driver.full_name || "—"],
    ["Phone", driver.phone || "—"],
    ["Vehicle type", driver.vehicle_type ? `${vehicleIcon(driver.vehicle_type)} ${driver.vehicle_type}` : "—"],
    ["Vehicle plate", driver.vehicle_label || driver.plate || "—"],
    ["License No.", driver.license_number || "—"],
    ["Status", driver.approval_status || "—"],
    ["Trips completed", driver.trips_completed ?? 0],
    ["Rating", driver.rating != null ? `⭐ ${driver.rating}` : "—"],
    ["Joined", driver.created_at ? tsLabel(driver.created_at) : "—"],
    ["Driver ID", driver.id],
  ] : [];

  const photoList: [string, string][] = [
    ["Profile photo", photos.profile],
    ["Selfie", photos.selfie],
    ["Vehicle", photos.vehicle],
    ["ID — front", photos.idFront],
    ["ID — back", photos.idBack],
    ["License — front", photos.licenseFront],
    ["License — back", photos.licenseBack],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <DriverAvatar id={id} name={driver?.full_name} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">{driver?.full_name || (loading ? "Loading…" : "Unknown driver")}</div>
            <div className="modal-sub">{driver?.phone || ""}</div>
          </div>
          {driver && <StatusPill status={driver.approval_status} />}
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? <p className="empty">Loading…</p> : !driver ? (
          <p className="empty">Driver not found.</p>
        ) : (
          <>
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <div className="stat-card"><div className="stat-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>✅</div><div className="stat-value" style={{ color: "var(--green)" }}>{stats.completed}</div><div className="stat-label">Completed</div></div>
              <div className="stat-card"><div className="stat-icon" style={{ background: "var(--red-soft)", color: "var(--red)" }}>🚫</div><div className="stat-value" style={{ color: "var(--red)" }}>{stats.cancelled}</div><div className="stat-label">Cancelled</div></div>
              <div className="stat-card"><div className="stat-icon" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}>💰</div><div className="stat-value" style={{ color: "var(--gold)" }}>{fmt(stats.total)}</div><div className="stat-label">Earned (L.L)</div></div>
              <div className="stat-card"><div className="stat-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>💵</div><div className="stat-value" style={{ color: "var(--green)" }}>{fmt(stats.payout)}</div><div className="stat-label">Payout (L.L)</div></div>
              <div className="stat-card"><div className="stat-icon" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>🏦</div><div className="stat-value" style={{ color: "var(--blue)" }}>{fmt(stats.commission)}</div><div className="stat-label">Commission (L.L)</div></div>
            </div>

            <h3 className="section-h">Photos</h3>
            <div className="photo-grid">
              {photoList.map(([label, url]) => (
                <ProfilePhoto key={label} label={label} url={url} onOpen={() => setLightbox(url)} />
              ))}
            </div>

            <h3 className="section-h">Details</h3>
            <div className="detail-table">
              {detailRows.map(([k, v]) => (
                <div className="detail-row" key={k}>
                  <span className="detail-key">{k}</span>
                  <span className="detail-val">{String(v)}</span>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              {driver.approval_status !== "approved" && <button className="btn-sm" style={{ background: "var(--green)" }} onClick={() => setStatus("approved")}>✓ Approve</button>}
              {driver.approval_status !== "suspended" && <button className="btn-sm danger-btn" onClick={() => setStatus("suspended")}>🚫 Ban</button>}
              <button className="btn-sm" onClick={sendDirectMessage}>✉️ Send message</button>
            </div>
          </>
        )}
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function ProfilePhoto({ label, url, onOpen }: { label: string; url: string; onOpen: () => void }) {
  const [err, setErr] = useState(false);
  return (
    <div className="photo-cell">
      {err ? (
        <div className="photo-missing">No photo</div>
      ) : (
        <img src={url} alt={label} onClick={onOpen} onError={() => setErr(true)} />
      )}
      <span className="photo-label">{label}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; t: string; label: string }> = {
    approved: { bg: "rgba(22,163,74,.2)", t: "var(--green)", label: "approved" },
    pending: { bg: "rgba(245,158,11,.2)", t: "var(--amber)", label: "pending" },
    suspended: { bg: "rgba(239,68,68,.2)", t: "var(--red)", label: "banned" },
    rejected: { bg: "rgba(239,68,68,.2)", t: "var(--red)", label: "banned" },
  };
  const c = map[status] || { bg: "var(--card2)", t: "var(--subtext)", label: status };
  return <span className="pill" style={{ background: c.bg, color: c.t }}>{c.label}</span>;
}

/* ------------------------------ Rides ------------------------------ */
function Rides({ showToast, onChange }: { showToast: (m: string) => void; onChange: () => void }) {
  const [filter, setFilter] = useState<RideFilter>("active");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    let res;
    if (filter === "active") {
      const cutoff = new Date(Date.now() - 6 * 3600000).toISOString();
      res = await supabase.from("rides").select("*").in("status", ACTIVE_STATUSES).gte("created_at", cutoff).order("created_at", { ascending: false }).limit(100);
    } else {
      res = await supabase.from("rides").select("*").eq("status", filter).order("created_at", { ascending: false }).limit(100);
    }
    const raw = res.data || [];
    const driverIds = [...new Set(raw.map((r) => r.driver_id).filter(Boolean))];
    const passengerIds = [...new Set(raw.map((r) => r.passenger_id).filter(Boolean))];
    const [{ data: dProfs }, { data: pProfs }] = await Promise.all([
      driverIds.length ? supabase.from("profiles").select("id, full_name, vehicle_type").in("id", driverIds) : Promise.resolve({ data: [] as any[] }),
      passengerIds.length ? supabase.from("profiles").select("id, full_name, phone").in("id", passengerIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const dMap = new Map((dProfs || []).map((p) => [p.id, p]));
    const pMap = new Map((pProfs || []).map((p) => [p.id, p]));
    setRows(raw.map((r) => ({ ...r, driver: dMap.get(r.driver_id), passenger: pMap.get(r.passenger_id) })));
    setLoading(false);
  }
  useEffect(() => { load(); }, [filter]);

  const visible = rows.filter((r) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return (
      String(r.id).toLowerCase().includes(s) ||
      (r.passenger?.full_name || "").toLowerCase().includes(s) ||
      (r.driver?.full_name || "").toLowerCase().includes(s) ||
      (r.passenger?.phone || "").includes(s)
    );
  });

  function exportCSV() {
    downloadCSV("rides", visible.map((r) => ({
      id: r.id,
      status: r.status,
      price: r.price,
      rider: r.passenger?.full_name || "",
      rider_phone: r.passenger?.phone || "",
      driver: r.driver?.full_name || "",
      created_at: tsLabel(r.created_at),
    })), [
      { key: "id", label: "Ride ID" },
      { key: "status", label: "Status" },
      { key: "price", label: "Price (L.L)" },
      { key: "rider", label: "Rider" },
      { key: "rider_phone", label: "Rider phone" },
      { key: "driver", label: "Driver" },
      { key: "created_at", label: "Created" },
    ]);
  }

  async function clearRides() {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} ${filter} ride(s)? This cannot be undone.`)) return;
    const { data: deleted, error } = await supabase.from("rides").delete().in("id", ids).select("id");
    if (error) return showToast("Error: " + error.message);
    if (!deleted || deleted.length === 0) {
      return showToast("Blocked by RLS — run supabase/admin_panel_fixes.sql first.");
    }
    showToast(`Deleted ${deleted.length} ride(s)`);
    load();
    onChange();
  }

  return (
    <>
      <h1 className="page-title">Rides</h1>
      <p className="page-sub">Active rides are limited to the last 6 hours</p>
      <div className="toolbar">
        <div className="filter-row" style={{ margin: 0 }}>
          {(["active", "completed", "cancelled"] as RideFilter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="search" placeholder="Search id, rider, driver…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {visible.length > 0 && <button className="btn-sm muted-btn" onClick={exportCSV}>⬇ CSV</button>}
          {rows.length > 0 && <button className="btn-sm danger-btn" onClick={clearRides}>Clear {filter}</button>}
        </div>
      </div>

      {loading ? <p className="empty">Loading…</p> : visible.length === 0 ? (
        <p className="empty">No {filter} rides{search ? " match your search" : ""}.</p>
      ) : visible.map((r) => (
        <div className="row-card" key={r.id}>
          <div className="row-main">
            <div className="row-title">#{String(r.id).slice(0, 6).toUpperCase()} · {r.price ? fmt(r.price) + " L.L" : "—"}</div>
            <div className="row-sub">
              Rider: {r.passenger?.full_name || "—"} · Driver: {r.driver?.full_name || "—"} · {new Date(/[Z+]/.test(r.created_at) ? r.created_at : r.created_at + "Z").toLocaleString()}
            </div>
          </div>
          <span className="pill" style={{ background: "var(--card2)", color: "var(--subtext)" }}>{r.status}</span>
        </div>
      ))}
    </>
  );
}

/* ------------------------------ Earnings ------------------------------ */
function Earnings({ showToast }: { showToast: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ today: 0, week: 0, commission: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 86400000);
    const [ridesRes, profRes] = await Promise.all([
      supabase.from("rides").select("id, driver_id, price, created_at").eq("status", "completed").order("created_at", { ascending: false }).limit(1000),
      supabase.from("profiles").select("id, full_name, vehicle_type, trips_completed, earnings_cleared_at").eq("role", "driver").order("full_name"),
    ]);
    const rides = ridesRes.data || [];
    const drivers = profRes.data || [];
    const ts = (c: string) => {
      if (!c) return new Date(NaN);
      let s = c.trim().replace(" ", "T");
      // Normalize "+00" / "-05" style offsets to "+00:00" so Date parses them.
      s = s.replace(/([+-]\d{2})$/, "$1:00");
      // No timezone marker at all → treat as UTC.
      if (!/[Z]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
      return new Date(s);
    };

    // A driver's "Clear" sets earnings_cleared_at; rides before that are excluded.
    const clearedAt = new Map<string, number>();
    drivers.forEach((d) => {
      if (d.earnings_cleared_at) clearedAt.set(d.id, ts(d.earnings_cleared_at).getTime());
    });
    const counts = (r: any) => {
      if (!r.driver_id) return false;
      const cut = clearedAt.get(r.driver_id);
      return cut === undefined || ts(r.created_at).getTime() > cut;
    };

    const earn = new Map<string, number>();
    const count = new Map<string, number>();
    rides.forEach((r) => {
      if (!counts(r)) return;
      earn.set(r.driver_id, (earn.get(r.driver_id) || 0) + (Number(r.price) || 0));
      count.set(r.driver_id, (count.get(r.driver_id) || 0) + 1);
    });
    const out = drivers.map((d) => {
      const total = earn.get(d.id) || 0;
      const rate = COMMISSION[d.vehicle_type] || DEFAULT_COMMISSION;
      return {
        ...d, total,
        commission: Math.round(total * rate),
        payout: Math.round(total * (1 - rate)),
        trips: count.get(d.id) || 0,
      };
    }).sort((a, b) => b.total - a.total);
    setRows(out);

    // Top totals respect each driver's clear time too.
    const today = rides.filter((r) => counts(r) && ts(r.created_at) >= todayStart).reduce((s, r) => s + (Number(r.price) || 0), 0);
    const week = rides.filter((r) => counts(r) && ts(r.created_at) >= weekStart).reduce((s, r) => s + (Number(r.price) || 0), 0);
    const commission = out.reduce((s, d) => s + d.commission, 0);
    setTotals({ today, week, commission });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function clearEarnings(id: string, name: string) {
    if (!confirm(`Reset displayed earnings for ${name || "this driver"}?`)) return;
    const { error } = await supabase.from("profiles").update({ earnings_cleared_at: new Date().toISOString() }).eq("id", id);
    if (error) return showToast("Error: " + error.message);
    showToast("Earnings cleared");
    load();
  }

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="page-title">Earnings</h1>
          <p className="page-sub">Completed rides · commission by vehicle type</p>
        </div>
        {rows.length > 0 && (
          <button className="btn-sm muted-btn" onClick={() => downloadCSV("earnings", rows, [
            { key: "full_name", label: "Driver" },
            { key: "vehicle_type", label: "Vehicle" },
            { key: "trips", label: "Trips" },
            { key: "total", label: "Earned (L.L)" },
            { key: "commission", label: "Commission (L.L)" },
            { key: "payout", label: "Payout (L.L)" },
          ])}>⬇ CSV</button>
        )}
      </div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-icon" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}>☀️</div><div className="stat-value" style={{ color: "var(--gold)" }}>{fmt(totals.today)}</div><div className="stat-label">Today (L.L)</div></div>
        <div className="stat-card"><div className="stat-icon" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}>📈</div><div className="stat-value" style={{ color: "var(--gold)" }}>{fmt(totals.week)}</div><div className="stat-label">This week (L.L)</div></div>
        <div className="stat-card"><div className="stat-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>💰</div><div className="stat-value" style={{ color: "var(--green)" }}>{fmt(totals.commission)}</div><div className="stat-label">Total commission (L.L)</div></div>
      </div>

      {loading ? <p className="empty">Loading…</p> : rows.length === 0 ? (
        <p className="empty">No drivers yet.</p>
      ) : rows.map((d) => (
        <div className="earn-card clickable" key={d.id} onClick={() => setSelectedId(d.id)}>
          <div className="earn-head">
            <DriverAvatar id={d.id} name={d.full_name} size={40} />
            <div className="earn-id">
              <div className="earn-name">{d.full_name || "Unknown"}</div>
              <span className="veh-badge">{vehicleIcon(d.vehicle_type)} {d.vehicle_type || "—"}</span>
            </div>
            <button className="btn-sm muted-btn" onClick={(e) => { e.stopPropagation(); clearEarnings(d.id, d.full_name); }}>Clear</button>
          </div>
          <div className="earn-stats">
            <div className="earn-stat"><span className="es-val">{d.trips}</span><span className="es-lbl">Trips</span></div>
            <div className="earn-stat"><span className="es-val" style={{ color: "var(--gold)" }}>{fmt(d.total)}</span><span className="es-lbl">Earned (L.L)</span></div>
            <div className="earn-stat"><span className="es-val" style={{ color: "var(--green)" }}>{fmt(d.payout)}</span><span className="es-lbl">Payout (L.L)</span></div>
            <div className="earn-stat"><span className="es-val" style={{ color: "var(--blue)" }}>{fmt(d.commission)}</span><span className="es-lbl">Commission (L.L)</span></div>
          </div>
        </div>
      ))}
      {selectedId && (
        <DriverProfile
          id={selectedId}
          onClose={() => setSelectedId(null)}
          showToast={showToast}
          onChange={load}
        />
      )}
    </>
  );
}

/* ------------------------------ Notify ------------------------------ */
type NotifyMode = "all" | "drivers" | "riders" | "person";

function Notify({ showToast }: { showToast: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<NotifyMode>("all");
  const [sending, setSending] = useState(false);

  // Specific-person search
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<any | null>(null);

  // Debounced search by name or phone (riders + drivers).
  useEffect(() => {
    if (mode !== "person") return;
    const q = search.trim();
    if (!q) { setResults([]); return; }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, phone, role")
        .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(20);
      if (active) { setResults(data || []); setSearching(false); }
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [search, mode]);

  async function send() {
    const t = title.trim();
    const b = body.trim();
    if (!b) return showToast("Please type a message first.");

    if (mode === "person") {
      if (!picked) return showToast("Pick a person to send to first.");
      if (!confirm(`Send this notification to ${picked.full_name || picked.phone || "this user"}?`)) return;
      setSending(true);
      const { error } = await supabase.from("notifications").insert({
        title: t || null, body: b, audience: "all", type: "admin", user_id: picked.id,
      });
      setSending(false);
      if (error) return showToast("Error: " + error.message);
      showToast(`Sent to ${picked.full_name || picked.phone} ✓`);
      setTitle(""); setBody(""); setPicked(null); setSearch(""); setResults([]);
      return;
    }

    const audience = mode as Audience;
    const label = audience === "drivers" ? "all drivers" : audience === "riders" ? "all riders" : "everyone";
    if (!confirm(`Send this notification to ${label}?`)) return;
    setSending(true);
    const { error } = await supabase.from("notifications").insert({ title: t || null, body: b, audience });
    setSending(false);
    if (error) return showToast("Error: " + error.message);
    showToast(`Sent to ${label} ✓`);
    setTitle(""); setBody("");
  }

  return (
    <>
      <h1 className="page-title">Notify</h1>
      <p className="page-sub">Broadcast an in-app notification, or message one person</p>
      <div className="notify-card">
        <p className="field-label">Send to</p>
        <div className="filter-row">
          {([
            ["all", "Everyone"],
            ["drivers", "All drivers"],
            ["riders", "All riders"],
            ["person", "Specific person"],
          ] as [NotifyMode, string][]).map(([m, lbl]) => (
            <button key={m} className={`chip ${mode === m ? "active" : ""}`}
              onClick={() => { setMode(m); setPicked(null); }}>
              {lbl}
            </button>
          ))}
        </div>

        {mode === "person" && (
          <div style={{ marginTop: 14 }}>
            {picked ? (
              <div className="earn-head" style={{ alignItems: "center" }}>
                <DriverAvatar id={picked.id} name={picked.full_name} size={36} />
                <div className="earn-id">
                  <div className="earn-name">{picked.full_name || "Unknown"}</div>
                  <span className="veh-badge">{picked.role === "driver" ? "🚗 Driver" : "🧍 Rider"} · {picked.phone || "—"}</span>
                </div>
                <button className="btn-sm muted-btn" onClick={() => setPicked(null)}>Change</button>
              </div>
            ) : (
              <>
                <input className="input" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or phone…" />
                {searching && <p className="page-sub" style={{ marginTop: 8 }}>Searching…</p>}
                {!searching && search.trim() && results.length === 0 && (
                  <p className="page-sub" style={{ marginTop: 8 }}>No matches.</p>
                )}
                {results.map((r) => (
                  <div key={r.id} className="earn-head" style={{ cursor: "pointer", marginTop: 8 }}
                    onClick={() => { setPicked(r); setResults([]); setSearch(""); }}>
                    <DriverAvatar id={r.id} name={r.full_name} size={34} />
                    <div className="earn-id">
                      <div className="earn-name">{r.full_name || "Unknown"}</div>
                      <span className="veh-badge">{r.role === "driver" ? "🚗 Driver" : "🧍 Rider"} · {r.phone || "—"}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <p className="field-label" style={{ marginTop: 14 }}>Title (optional)</p>
        <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Service update" />

        <p className="field-label" style={{ marginTop: 14 }}>Message</p>
        <textarea value={body} maxLength={240} onChange={(e) => setBody(e.target.value)} placeholder="Type your message…" />
        <div className="char-count">{body.length}/240</div>

        <button className="btn" onClick={send} disabled={sending}>
          {sending ? "Sending…" : mode === "person" ? "✉️ Send message" : "📣 Send notification"}
        </button>
      </div>
    </>
  );
}
