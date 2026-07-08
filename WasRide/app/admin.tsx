import {
  View, Text, StyleSheet, Pressable, FlatList,
  Alert, Image, ScrollView, TextInput, ActivityIndicator, Modal,
} from "react-native";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import { useAppState } from "@/lib/app-state";
import { recordNotification } from "@/lib/inbox";

// ─── Constants ────────────────────────────────────────────────────────────────
const GOLD   = '#F4B400';
const RED    = '#EF4444';
const GREEN  = '#22C55E';
const YELLOW = '#EAB308';
const ORANGE = '#F97316';

const COMMISSION: Record<string, number> = {
  Motorcycle: 0.10,
  Tuktuk:     0.12,
  Car:        0.15,
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab          = 'dashboard' | 'drivers' | 'rides' | 'earnings' | 'reports';
type DriverFilter = 'pending' | 'approved' | 'suspended' | 'rejected' | 'all';
type RideFilter   = 'active' | 'completed' | 'cancelled';
type NotifyAudience = 'drivers' | 'riders' | 'all';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatPhone(phone: string) {
  if (!phone) return '';
  if (phone.startsWith('+961')) return '+961 ' + phone.slice(4);
  return phone;
}
function vehicleIcon(type: string) {
  return type === 'Tuktuk' ? '🛺' : type === 'Car' ? '🚗' : '🏍';
}
function driverStatusColor(status: string) {
  switch (status) {
    case 'approved':  return GREEN;
    case 'pending':   return YELLOW;
    case 'suspended': return RED;
    case 'rejected':  return RED;
    default:          return '#94A3B8';
  }
}
function driverStatusLabel(status: string) {
  switch (status) {
    case 'approved':  return 'Active';
    case 'pending':   return 'Pending';
    case 'suspended': return 'Banned';
    case 'rejected':  return 'Banned';
    default:          return 'Unknown';
  }
}
function rideStatusColor(status: string) {
  switch (status) {
    case 'completed':     return GREEN;
    case 'cancelled':     return RED;
    case 'searching':     return YELLOW;
    case 'counter_offer': return ORANGE;
    case 'accepted':
    case 'tracking':      return GOLD;
    default:              return '#94A3B8';
  }
}
function rideStatusLabel(status: string) {
  switch (status) {
    case 'completed':     return 'Completed';
    case 'cancelled':     return 'Cancelled';
    case 'searching':     return 'Searching';
    case 'counter_offer': return 'Negotiating';
    case 'accepted':      return 'En Route';
    case 'tracking':      return 'In Progress';
    default:              return status;
  }
}
function timeAgo(iso: string) {
  if (!iso) return '—';
  const utc = /[Z+]/.test(iso) ? iso : iso + 'Z';
  const diff = Date.now() - new Date(utc).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function dayLabel(daysAgo: number) {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yest';
  const d = new Date(Date.now() - daysAgo * 86400000);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}
function deliveryLabel(item: any) {
  if (item.service !== 'delivery') return null;
  try {
    const n = JSON.parse(item.note || '{}');
    if (n._t === 'store') return '🏪 Store';
    if (n._t === 'pkg')   return '📦 Package';
  } catch {}
  return '🚚 Delivery';
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ width, height, radius = 8, style }: { width: any; height: number; radius?: number; style?: any }) {
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: '#374151', opacity: 0.2 }, style]} />;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, accent, cardBg, textColor, subtextColor, fullWidth }: {
  icon: string; value: string | number; label: string; accent: string;
  cardBg: string; textColor: string; subtextColor: string; fullWidth?: boolean;
}) {
  return (
    <View style={[sc.card, { backgroundColor: cardBg }, fullWidth && { flex: 0, width: '100%' }]}>
      <Text style={[sc.icon, { color: accent }]}>{icon}</Text>
      <Text style={[sc.value, { color: textColor }]}>{value}</Text>
      <Text style={[sc.label, { color: subtextColor }]}>{label}</Text>
    </View>
  );
}
const sc = StyleSheet.create({
  card:  { flex: 1, borderRadius: 20, padding: 18, margin: 4, minHeight: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 10, elevation: 4 },
  icon:  { fontSize: 24, marginBottom: 10 },
  value: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600' },
});

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <View style={[sb.wrap, { backgroundColor: color + '22' }]}>
      <View style={[sb.dot, { backgroundColor: color }]} />
      <Text style={[sb.text, { color }]}>{label}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  dot:  { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: '800' },
});

// ─── Filter Row ───────────────────────────────────────────────────────────────
function FilterRow<T extends string>({ options, active, onSelect, cardBg, borderColor, subtextColor }: {
  options: { key: T; label: string }[];
  active: T;
  onSelect: (k: T) => void;
  cardBg: string; borderColor: string; subtextColor: string;
}) {
  return (
    <View style={fr.row}>
      {options.map(o => {
        const isActive = o.key === active;
        return (
          <Pressable key={o.key} onPress={() => onSelect(o.key)}
            style={[fr.tab, { backgroundColor: isActive ? GOLD : cardBg, borderColor }]}>
            <Text style={[fr.text, { color: isActive ? '#000' : subtextColor }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const fr = StyleSheet.create({
  row:  { flexDirection: 'row', marginBottom: 12, gap: 6 },
  tab:  { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  text: { fontSize: 11, fontWeight: '700' },
});

// ─── Bar Chart ────────────────────────────────────────────────────────────────
function BarChart({ data, cardBg, textColor, subtextColor, borderColor }: {
  data: { label: string; value: number }[];
  cardBg: string; textColor: string; subtextColor: string; borderColor: string;
}) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const totalWeek = data.reduce((s, d) => s + d.value, 0);
  return (
    <View style={[bch.container, { backgroundColor: cardBg, borderColor, borderWidth: 1 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: textColor }}>7-Day Revenue</Text>
        <Text style={{ fontSize: 13, fontWeight: '800', color: GREEN }}>
          {totalWeek > 0 ? totalWeek.toLocaleString() + ' L.L' : '—'}
        </Text>
      </View>
      <View style={bch.barsWrap}>
        {data.map((d, i) => {
          const heightPct = Math.max(4, (d.value / maxVal) * 88);
          return (
            <View key={i} style={bch.barCol}>
              {d.value > 0 && (
                <Text style={[bch.barVal, { color: GOLD }]}>
                  {d.value >= 1000 ? (d.value / 1000).toFixed(0) + 'k' : d.value}
                </Text>
              )}
              <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <View style={[bch.bar, { height: heightPct, backgroundColor: d.value > 0 ? GOLD : borderColor }]} />
              </View>
              <Text style={[bch.barLabel, { color: subtextColor }]}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
const bch = StyleSheet.create({
  container: { borderRadius: 18, padding: 16, marginBottom: 12 },
  barsWrap:  { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 4 },
  barCol:    { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4 },
  bar:       { width: '70%', borderRadius: 4, minHeight: 4 },
  barVal:    { fontSize: 8, fontWeight: '800', textAlign: 'center' },
  barLabel:  { fontSize: 9, fontWeight: '700', textAlign: 'center' },
});

// ─── Quick Action ─────────────────────────────────────────────────────────────
function QuickAction({ icon, label, onPress, cardBg, textColor }: any) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [qa.btn, { backgroundColor: cardBg, opacity: pressed ? 0.6 : 1 }]}>
      <Text style={qa.icon}>{icon}</Text>
      <Text style={[qa.label, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}
const qa = StyleSheet.create({
  btn:   { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 14, margin: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  icon:  { fontSize: 20, marginBottom: 4 },
  label: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminScreen() {
  const router = useRouter();
  const { locale, darkMode, isAdmin } = useAppState();

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 48 }}>🚫</Text>
        <Text style={{ fontSize: 16, marginTop: 12, color: '#6B7280' }}>Access denied</Text>
      </View>
    );
  }

  // ─── Theme ────────────────────────────────────────────────────────────────
  const bg           = darkMode ? '#0F172A' : '#F1F5F9';
  const cardBg       = darkMode ? '#1E293B' : '#FFFFFF';
  const textColor    = darkMode ? '#F1F5F9' : '#0F172A';
  const subtextColor = darkMode ? '#94A3B8' : '#64748B';
  const borderColor  = darkMode ? '#334155' : '#E2E8F0';

  // ─── State ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // Dashboard
  const [stats, setStats] = useState({
    pendingDrivers: 0, driversOnline: 0, activeRides: 0,
    completedRides: 0, cancelledRides: 0, totalUsers: 0,
    todayRevenue: 0, weekRevenue: 0, allTimeRevenue: 0,
  });
  const [statsLoading, setStatsLoading]     = useState(true);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [chartData, setChartData]           = useState<{ label: string; value: number }[]>([]);

  // Drivers
  const [drivers, setDrivers]             = useState<any[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driverFilter, setDriverFilter]   = useState<DriverFilter>('pending');
  const [driverSearch, setDriverSearch]   = useState('');
  const [banTarget, setBanTarget]         = useState<any>(null); // driver being banned (ban-message modal)
  const [banText, setBanText]             = useState('');
  const [msgTarget, setMsgTarget]         = useState<any>(null); // user being messaged (direct-message modal)
  const [msgText, setMsgText]             = useState('');

  // Rides
  const [rides, setRides]               = useState<any[]>([]);
  const [ridesLoading, setRidesLoading] = useState(false);
  const [rideFilter, setRideFilter]     = useState<RideFilter>('active');

  // Earnings
  const [driverEarnings, setDriverEarnings]   = useState<any[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [todayRev, setTodayRev]               = useState(0);
  const [weekRev, setWeekRev]                 = useState(0);
  const [totalCommission, setTotalCommission] = useState(0);

  // Notifications (broadcast)
  const [notifyTitle, setNotifyTitle]     = useState('');
  const [notifyBody, setNotifyBody]        = useState('');
  const [notifyAudience, setNotifyAudience] = useState<NotifyAudience>('all');
  const [notifySending, setNotifySending]  = useState(false);

  // ─── Refs (keep interval callbacks from reading stale closure values) ────────
  const activeTabRef   = useRef<Tab>(activeTab);
  const rideFilterRef    = useRef<RideFilter>(rideFilter);
  const driverFilterRef  = useRef<DriverFilter>(driverFilter);
  const ridesClearedRef    = useRef(false);
  const earningsClearedRef = useRef(false);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  // rideFilterRef and driverFilterRef are synced immediately in the tap handlers below
  // (not via useEffect) so the interval never reads a stale value

  useEffect(() => { loadDashboard(); }, []);
  // Only reload on tab switch — filter changes are handled directly in the handler functions below
  useEffect(() => { if (activeTab === 'drivers')  loadDrivers(false, driverFilter);  }, [activeTab]);
  // Only load if not cleared — switching tabs won't override a manual Clear press
  useEffect(() => { if (activeTab === 'rides')    { if (!ridesClearedRef.current)    loadRides(false, rideFilter);  } }, [activeTab]);
  useEffect(() => { if (activeTab === 'earnings') { if (!earningsClearedRef.current) loadEarnings(); }              }, [activeTab]);

  useEffect(() => {
    const id = setInterval(() => {
      const tab = activeTabRef.current;
      if (tab === 'dashboard') loadDashboard(true);
      else if (tab === 'drivers')  loadDrivers(true, driverFilterRef.current);
      else if (tab === 'rides'    && !ridesClearedRef.current)    loadRides(true, rideFilterRef.current);
      else if (tab === 'earnings' && !earningsClearedRef.current) loadEarnings(true);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // ─── Data Loaders ─────────────────────────────────────────────────────────
  async function loadDashboard(silent = false) {
    if (!silent) setStatsLoading(true);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const weekStart  = new Date(Date.now() - 7 * 86400000);
      // Match the Rides "active" view: only count rides started in the last 6 hours,
      // so the dashboard stat and the bottom-nav badge never show stale orphaned rides.
      const activeCutoff = new Date(Date.now() - 6 * 3600000).toISOString();

      const [
        { count: pending },
        { count: online },
        { count: active },
        { count: completed },
        { count: cancelled },
        { count: users },
        { data: todayRides },
        { data: weekRides },
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'driver').eq('approval_status', 'pending'),
        supabase.from('driver_presence').select('driver_id', { count: 'exact', head: true }).eq('is_online', true),
        supabase.from('rides').select('id', { count: 'exact', head: true }).in('status', ['searching','accepted','tracking','counter_offer']).gte('created_at', activeCutoff),
        supabase.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'cancelled'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'rider'),
        supabase.from('rides').select('price').eq('status', 'completed').gte('created_at', todayStart.toISOString()),
        supabase.from('rides').select('price').eq('status', 'completed').gte('created_at', weekStart.toISOString()),
      ]);

      const todayRev = (todayRides || []).reduce((s: number, r: any) => s + (Number(r.price) || 0), 0);
      const weekRev  = (weekRides  || []).reduce((s: number, r: any) => s + (Number(r.price) || 0), 0);

      // All-time revenue: sum of every completed ride, but subtract earnings that
      // have been cleared per-driver (a ride created before that driver's
      // earnings_cleared_at no longer counts toward the running total).
      const ts = (c: string) => {
        if (!c) return new Date(NaN);
        let s = c.trim().replace(' ', 'T');
        s = s.replace(/([+-]\d{2})$/, '$1:00');
        if (!/[Z]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
        return new Date(s);
      };
      const [allRidesRes, clearProfRes] = await Promise.all([
        supabase.from('rides').select('driver_id, price, created_at').eq('status', 'completed').limit(5000),
        supabase.from('profiles').select('id, earnings_cleared_at').eq('role', 'driver'),
      ]);
      const clearedAt = new Map<string, number>();
      (clearProfRes.data || []).forEach((d: any) => {
        if (d.earnings_cleared_at) clearedAt.set(d.id, ts(d.earnings_cleared_at).getTime());
      });
      const allTimeRev = (allRidesRes.data || []).reduce((s: number, r: any) => {
        const cut = r.driver_id ? clearedAt.get(r.driver_id) : undefined;
        if (cut !== undefined && ts(r.created_at).getTime() <= cut) return s; // cleared
        return s + (Number(r.price) || 0);
      }, 0);

      setStats({
        pendingDrivers: pending   || 0,
        driversOnline:  online    || 0,
        activeRides:    active    || 0,
        completedRides: completed || 0,
        cancelledRides: cancelled || 0,
        totalUsers:     users     || 0,
        todayRevenue:   todayRev,
        weekRevenue:    weekRev,
        allTimeRevenue: allTimeRev,
      });

      // Build 7-day chart from weekRides
      const dayMap = new Map<number, number>();
      for (let i = 0; i < 7; i++) dayMap.set(i, 0);
      (weekRides || []).forEach((r: any) => {
        const ts  = /[Z+]/.test(r.created_at) ? r.created_at : r.created_at + 'Z';
        const ago = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
        if (ago >= 0 && ago < 7) dayMap.set(ago, (dayMap.get(ago) || 0) + (Number(r.price) || 0));
      });
      const chart = Array.from({ length: 7 }, (_, i) => ({
        label: dayLabel(6 - i),
        value: dayMap.get(6 - i) || 0,
      }));
      setChartData(chart);

      // Recent activity feed
      const [{ data: recentRides }, { data: recentDrivers }] = await Promise.all([
        supabase.from('rides').select('id, status, created_at, price').order('created_at', { ascending: false }).limit(5),
        supabase.from('profiles').select('id, full_name, approval_status, created_at').eq('role', 'driver').order('created_at', { ascending: false }).limit(4),
      ]);
      const feed: any[] = [];
      recentDrivers?.forEach(d => {
        const icon = d.approval_status === 'approved' ? '✅' : d.approval_status === 'rejected' ? '❌' : '⏳';
        const text = d.approval_status === 'approved'
          ? `Driver ${d.full_name || 'Unknown'} approved`
          : d.approval_status === 'rejected'
          ? `Driver ${d.full_name || 'Unknown'} rejected`
          : `New driver application: ${d.full_name || 'Unknown'}`;
        feed.push({ key: `d-${d.id}`, icon, text, time: d.created_at });
      });
      recentRides?.forEach(r => {
        const icon = r.status === 'completed' ? '🏁' : r.status === 'cancelled' ? '🚫' : '🚕';
        const text = r.status === 'completed'
          ? `Ride completed${r.price ? ` · ${Number(r.price).toLocaleString()} L.L` : ''}`
          : r.status === 'cancelled' ? `Ride cancelled`
          : `Active ride #${r.id.slice(0, 6).toUpperCase()}`;
        feed.push({ key: `r-${r.id}`, icon, text, time: r.created_at });
      });
      feed.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setRecentActivity(feed.slice(0, 8));
    } catch (e) { console.log('Dashboard error:', e); }
    setStatsLoading(false);
  }

  async function loadDrivers(silent = false, filter: DriverFilter = driverFilter) {
    if (!silent) setDriversLoading(true);
    try {
      let q = supabase.from('profiles').select('*').eq('role', 'driver');
      if (filter !== 'all') q = q.eq('approval_status', filter);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) console.log('loadDrivers error:', error.message);
      setDrivers(data || []);
    } catch (e: any) { console.log('loadDrivers exception:', e?.message); }
    setDriversLoading(false);
  }

  async function loadRides(silent = false, filter: RideFilter = rideFilter) {
    if (!silent) setRidesLoading(true);
    try {
      // Each branch is a fully independent awaited query — no builder reuse or type issues
      let ridesRaw: any[] | null = null;
      let ridesErr: any = null;

      if (filter === 'active') {
        // Only show rides started in the last 6 hours — orphaned old "En Route" rides are excluded
        const cutoff = new Date(Date.now() - 6 * 3600000).toISOString();
        const res = await supabase.from('rides').select('*')
          .in('status', ['searching', 'accepted', 'tracking', 'counter_offer'])
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false }).limit(100);
        ridesRaw = res.data; ridesErr = res.error;
      } else if (filter === 'completed') {
        const res = await supabase.from('rides').select('*')
          .eq('status', 'completed')
          .order('created_at', { ascending: false }).limit(100);
        ridesRaw = res.data; ridesErr = res.error;
      } else {
        const res = await supabase.from('rides').select('*')
          .eq('status', 'cancelled')
          .order('created_at', { ascending: false }).limit(100);
        ridesRaw = res.data; ridesErr = res.error;
      }

      if (ridesErr) { console.log('loadRides error:', ridesErr.message); setRides([]); setRidesLoading(false); return; }
      if (!ridesRaw?.length) { setRides([]); setRidesLoading(false); return; }

      // Client-side safety filter — ensures correct rides even if a stale interval call snuck in
      const activeStatuses = ['searching', 'accepted', 'tracking', 'counter_offer'];
      const filtered = ridesRaw.filter((r: any) => {
        if (filter === 'active')    return activeStatuses.includes(r.status);
        if (filter === 'completed') return r.status === 'completed';
        return r.status === 'cancelled';
      });

      const driverIds    = [...new Set(filtered.map((r: any) => r.driver_id).filter(Boolean))];
      const passengerIds = [...new Set(filtered.map((r: any) => r.passenger_id).filter(Boolean))];

      const [{ data: driverProfs }, { data: passengerProfs }] = await Promise.all([
        driverIds.length    ? supabase.from('profiles').select('id, full_name, vehicle_type').in('id', driverIds)    : Promise.resolve({ data: [] as any[] }),
        passengerIds.length ? supabase.from('profiles').select('id, full_name, phone').in('id', passengerIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const driverMap    = new Map((driverProfs    || []).map((p: any) => [p.id, p]));
      const passengerMap = new Map((passengerProfs || []).map((p: any) => [p.id, p]));
      setRides(filtered.map((r: any) => ({
        ...r,
        driver:    driverMap.get(r.driver_id)       || null,
        passenger: passengerMap.get(r.passenger_id) || null,
      })));
    } catch (e: any) { console.log('loadRides exception:', e?.message); }
    setRidesLoading(false);
  }

  // Permanently delete the rides currently shown for this filter, so they don't
  // reappear on the next refresh. Requires the admin DELETE policy on rides.
  function clearRides() {
    const ids = rides.map((r: any) => r.id);
    if (!ids.length) { ridesClearedRef.current = true; setRides([]); return; }
    const label = rideFilter === 'active' ? 'active' : rideFilter === 'completed' ? 'completed' : 'cancelled';
    Alert.alert(
      'Clear Rides',
      `Permanently delete ${ids.length} ${label} ride${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          // .select() makes the delete return the rows it actually removed, so we can
          // detect the case where RLS silently blocks the delete (0 rows, no error).
          const { data: deleted, error } = await supabase.from('rides').delete().in('id', ids).select('id');
          if (error) { Alert.alert('Error', error.message); return; }
          if (!deleted || deleted.length === 0) {
            Alert.alert(
              'Nothing deleted',
              'The database blocked the delete. Run supabase/admin_rides_delete_policy.sql in the Supabase SQL editor, then try again.',
            );
            return;
          }
          ridesClearedRef.current = true;
          setRides([]);
          loadDashboard(true);
        }},
      ],
    );
  }

  async function loadEarnings(silent = false) {
    if (!silent) setEarningsLoading(true);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const weekStart  = new Date(Date.now() - 7 * 86400000);

      const [ridesResult, profilesResult] = await Promise.all([
        supabase.from('rides').select('id, driver_id, price, created_at').eq('status', 'completed').order('created_at', { ascending: false }).limit(1000),
        supabase.from('profiles').select('id, full_name, vehicle_type, trips_completed, earnings_cleared_at').eq('role', 'driver').order('full_name'),
      ]);

      const ridesData      = ridesResult.data;
      const driverProfiles = profilesResult.data;
      if (ridesResult.error)    console.log('loadEarnings rides error:', ridesResult.error.message);
      if (profilesResult.error) console.log('loadEarnings profiles error:', profilesResult.error.message);
      console.log('loadEarnings: drivers=', driverProfiles?.length ?? 0, 'rides=', ridesData?.length ?? 0);

      // Robust timestamptz parser: handles space separators and "+00" offsets.
      const ts = (c: string) => {
        if (!c) return new Date(NaN);
        let s = c.trim().replace(' ', 'T');
        s = s.replace(/([+-]\d{2})$/, '$1:00');
        if (!/[Z]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
        return new Date(s);
      };

      const profileMap = new Map<string, any>();
      (driverProfiles || []).forEach((d: any) => profileMap.set(d.id, d));

      // A driver's "Clear" sets earnings_cleared_at; rides before that are excluded.
      const clearedAt = new Map<string, number>();
      (driverProfiles || []).forEach((d: any) => {
        if (d.earnings_cleared_at) clearedAt.set(d.id, ts(d.earnings_cleared_at).getTime());
      });
      const counts = (r: any) => {
        if (!r.driver_id) return false;
        const cut = clearedAt.get(r.driver_id);
        return cut === undefined || ts(r.created_at).getTime() > cut;
      };

      const earningsMap    = new Map<string, number>();
      const ridesPerDriver = new Map<string, any[]>();

      (ridesData || []).forEach((r: any) => {
        if (!counts(r)) return;
        const amt = Number(r.price) || 0;
        earningsMap.set(r.driver_id, (earningsMap.get(r.driver_id) || 0) + amt);
        const list = ridesPerDriver.get(r.driver_id) || [];
        list.push({ id: r.id, price: amt, created_at: r.created_at });
        ridesPerDriver.set(r.driver_id, list);
      });

      const rows = (driverProfiles || []).map((d: any) => {
        const total = earningsMap.get(d.id) || 0;
        const rate  = COMMISSION[d.vehicle_type] || 0.10;
        return {
          ...d,
          total,
          commission:  Math.round(total * rate),
          payout:      Math.round(total * (1 - rate)),
          rides:       ridesPerDriver.get(d.id) || [],
          totalTrips:  ridesPerDriver.get(d.id)?.length || d.trips_completed || 0,
        };
      });
      setDriverEarnings(rows);

      // Today & week totals
      const todayRev = (ridesData || []).filter((r: any) =>
        counts(r) && ts(r.created_at) >= todayStart
      ).reduce((s: number, r: any) => s + (Number(r.price) || 0), 0);
      const weekRev  = (ridesData || []).filter((r: any) =>
        counts(r) && ts(r.created_at) >= weekStart
      ).reduce((s: number, r: any) => s + (Number(r.price) || 0), 0);
      const commission = rows.reduce((s: number, d: any) => s + d.commission, 0);

      setTodayRev(todayRev);
      setWeekRev(weekRev);
      setTotalCommission(commission);
    } catch (e) { console.log('loadEarnings error:', e); }
    setEarningsLoading(false);
  }

  // ─── Driver Actions ───────────────────────────────────────────────────────
  async function setDriverStatus(driverId: string, newStatus: string, banMessage?: string) {
    const update: any = { approval_status: newStatus };
    if (newStatus === 'suspended') update.ban_message = banMessage?.trim() || null;
    else if (newStatus === 'approved') update.ban_message = null;
    const { error } = await supabase.from('profiles')
      .update(update).eq('id', driverId);
    if (error) { Alert.alert('Error', error.message); return; }
    if (newStatus === 'rejected' || newStatus === 'suspended') {
      await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', driverId);
      recordNotification({
        userId: driverId,
        type: 'ban',
        title: 'Account Banned',
        body: banMessage?.trim() || 'Your account has been banned. Contact support for details.',
      }).catch(() => {});
    }
    loadDrivers(true);
    loadDashboard(true);
  }

  // Open the ban-message modal for a driver
  function promptBan(driver: any) {
    setBanTarget(driver);
    setBanText('');
  }

  // Open the direct-message modal for a single user
  function promptMessage(driver: any) {
    setMsgTarget(driver);
    setMsgText('');
  }

  async function sendDirectMessage() {
    const target = msgTarget;
    const body = msgText.trim();
    setMsgTarget(null);
    if (!target || !body) return;
    await recordNotification({ userId: target.id, type: 'admin', title: 'Message from Support', body });
    Alert.alert('Sent', `Message sent to ${target.full_name || 'user'}.`);
  }

  function showDriverActions(item: any) {
    const name   = item.full_name || 'this driver';
    const status = item.approval_status;
    const buttons: any[] = [];
    if (status !== 'approved')  buttons.push({ text: '✓ Approve',  onPress: () => setDriverStatus(item.id, 'approved') });
    if (status !== 'suspended' && status !== 'rejected')
      buttons.push({ text: '🚫 Ban', style: 'destructive', onPress: () => promptBan(item) });
    if (status === 'rejected' || status === 'suspended')
      buttons.push({ text: '✓ Reactivate', onPress: () => setDriverStatus(item.id, 'approved') });
    buttons.push({ text: '✉️ Send message', onPress: () => promptMessage(item) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`Driver: ${name}`, `Status: ${driverStatusLabel(status)}`, buttons);
  }

  async function clearDriverEarnings(driverId: string, name: string) {
    Alert.alert('Clear Earnings', `Reset displayed earnings for ${name || 'this driver'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('profiles')
          .update({ earnings_cleared_at: new Date().toISOString() }).eq('id', driverId);
        if (error) { Alert.alert('Error', error.message); return; }
        loadEarnings();
        loadDashboard(true); // keep all-time revenue in sync with the clear
      }},
    ]);
  }

  // ─── Broadcast push notification ────────────────────────────────────────────
  async function sendBroadcast() {
    const title = notifyTitle.trim();
    const body  = notifyBody.trim();
    if (!body) { Alert.alert('Message required', 'Please type a message before sending.'); return; }

    const audienceLabel = notifyAudience === 'drivers' ? 'all drivers'
      : notifyAudience === 'riders' ? 'all riders' : 'everyone';

    Alert.alert('Send Notification', `Send this notification to ${audienceLabel}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setNotifySending(true);
        try {
          // 1) Save the notification — driver/rider apps receive it in real time
          //    via Supabase, so this works even without push tokens (e.g. in Expo Go).
          const { error } = await supabase.from('notifications').insert({
            title: title || null,
            body,
            audience: notifyAudience,
          });
          if (error) { Alert.alert('Error', error.message); setNotifySending(false); return; }

          // 2) Best-effort: also send a real push to any registered devices (real builds only).
          try {
            let q = supabase.from('profiles').select('expo_push_token').not('expo_push_token', 'is', null);
            if (notifyAudience === 'drivers')      q = q.eq('role', 'driver');
            else if (notifyAudience === 'riders')  q = q.eq('role', 'rider');
            else                                   q = q.in('role', ['rider', 'driver']);
            const { data } = await q;
            const tokens = [...new Set((data || []).map((r: any) => r.expo_push_token).filter(Boolean))];
            const messages = tokens.map(to => ({
              to, sound: 'default', title: title || 'Wasl', body, data: { type: 'admin_broadcast' },
            }));
            for (let i = 0; i < messages.length; i += 100) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(messages.slice(i, i + 100)),
              });
            }
          } catch { /* push is optional — the in-app notification already went out */ }

          Alert.alert('Sent ✓', `Notification sent to ${audienceLabel}.`);
          setNotifyTitle(''); setNotifyBody('');
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Failed to send notification.');
        }
        setNotifySending(false);
      }},
    ]);
  }

  const driverPhotoUrl = (id: string) =>
    supabase.storage.from('driver-images').getPublicUrl(`drivers/${id}.jpg`).data.publicUrl;

  const filteredDrivers = driverSearch.trim()
    ? drivers.filter(d => (d.full_name || '').toLowerCase().includes(driverSearch.toLowerCase())
        || (d.phone || '').includes(driverSearch))
    : drivers;

  // ─── Tab: Dashboard ──────────────────────────────────────────────────────
  const renderDashboard = useCallback(() => {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {statsLoading ? (
          <>
            {[0,1,2].map(i => (
              <View key={i} style={s.statsRow}>
                <Skeleton width="47%" height={120} radius={20} style={{ margin: 4 }} />
                <Skeleton width="47%" height={120} radius={20} style={{ margin: 4 }} />
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={s.statsRow}>
              <StatCard icon="⏳" value={stats.pendingDrivers} label="Pending Drivers" accent={YELLOW} cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard icon="🟢" value={stats.driversOnline}  label="Drivers Online"  accent={GREEN}  cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
            </View>
            <View style={s.statsRow}>
              <StatCard icon="🚕" value={stats.activeRides}   label="Active Rides"    accent={GOLD}   cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard
                icon="💰"
                value={stats.todayRevenue > 0 ? stats.todayRevenue.toLocaleString() : '0'}
                label="Revenue Today (L.L)"
                accent={GREEN}
                cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
              />
            </View>
            <View style={s.statsRow}>
              <StatCard icon="✅" value={stats.completedRides} label="Completed Rides" accent={GREEN}  cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard icon="🚫" value={stats.cancelledRides} label="Canceled Rides"  accent={RED}    cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
            </View>
            <View style={s.statsRow}>
              <StatCard
                icon="📈"
                value={stats.weekRevenue > 0 ? stats.weekRevenue.toLocaleString() : '0'}
                label="Revenue This Week (L.L)"
                accent={GOLD}
                cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
              />
              <StatCard icon="👥" value={stats.totalUsers} label="Total Riders" accent={GOLD} cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
            </View>
            <View style={s.statsRow}>
              <StatCard
                icon="🏦"
                value={stats.allTimeRevenue > 0 ? stats.allTimeRevenue.toLocaleString() : '0'}
                label="All-Time Revenue (L.L)"
                accent={GREEN}
                cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
                fullWidth
              />
            </View>
          </>
        )}

        {/* 7-Day Chart */}
        {chartData.length > 0 && !statsLoading && (
          <BarChart data={chartData} cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} borderColor={borderColor} />
        )}

        {/* Quick Actions */}
        <Text style={[s.sectionTitle, { color: textColor, marginTop: 4 }]}>Quick Actions</Text>
        <View style={s.statsRow}>
          <QuickAction icon="👤" label={`Approve\nDrivers`}  onPress={() => { setDriverFilter('pending'); setActiveTab('drivers'); }} cardBg={cardBg} textColor={textColor} />
          <QuickAction icon="🚕" label={`Live\nRides`}       onPress={() => { setRideFilter('active'); setActiveTab('rides'); }}     cardBg={cardBg} textColor={textColor} />
          <QuickAction icon="💰" label={`Earnings`}          onPress={() => setActiveTab('earnings')}                                cardBg={cardBg} textColor={textColor} />
          <QuickAction icon="📣" label={`Notify`}            onPress={() => setActiveTab('reports')}                                 cardBg={cardBg} textColor={textColor} />
        </View>

        {/* Recent Activity */}
        <Text style={[s.sectionTitle, { color: textColor, marginTop: 16 }]}>Recent Activity</Text>
        <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
          {recentActivity.length === 0 ? (
            <Text style={{ color: subtextColor, textAlign: 'center', padding: 20, fontSize: 13 }}>No recent activity</Text>
          ) : recentActivity.map((item, i) => (
            <View key={item.key} style={[s.activityRow, { borderBottomColor: borderColor, borderBottomWidth: i < recentActivity.length - 1 ? 1 : 0 }]}>
              <Text style={s.activityIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.activityText, { color: textColor }]}>{item.text}</Text>
                <Text style={[s.activityTime, { color: subtextColor }]}>{timeAgo(item.time)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }, [statsLoading, stats, chartData, recentActivity, cardBg, textColor, subtextColor, borderColor, bg, darkMode]);

  // ─── Tab: Drivers ─────────────────────────────────────────────────────────
  const renderDrivers = useCallback(() => {
    return (
      <View style={{ flex: 1 }}>
        <View style={[s.searchBar, { backgroundColor: cardBg, borderColor }]}>
          <Text style={{ color: subtextColor, marginRight: 8, fontSize: 14 }}>🔍</Text>
          <TextInput
            value={driverSearch}
            onChangeText={setDriverSearch}
            placeholder="Search by name or phone..."
            placeholderTextColor={subtextColor}
            style={[s.searchInput, { color: textColor }]}
          />
          {driverSearch.length > 0 && (
            <Pressable onPress={() => setDriverSearch('')}>
              <Text style={{ color: subtextColor, fontSize: 16, paddingLeft: 8 }}>✕</Text>
            </Pressable>
          )}
        </View>

        <FilterRow
          options={[
            { key: 'pending'   as DriverFilter, label: 'Pending' },
            { key: 'approved'  as DriverFilter, label: 'Active' },
            { key: 'suspended' as DriverFilter, label: 'Banned' },
            { key: 'all'       as DriverFilter, label: 'All' },
          ]}
          active={driverFilter}
          onSelect={(f: DriverFilter) => { driverFilterRef.current = f; setDriverFilter(f); loadDrivers(false, f); }}
          cardBg={cardBg} borderColor={borderColor} subtextColor={subtextColor}
        />

        {driversLoading ? (
          <View style={{ paddingTop: 4, gap: 10 }}>
            {[1,2,3].map(i => <Skeleton key={i} width="100%" height={130} radius={16} />)}
          </View>
        ) : (
          <FlatList
            data={filteredDrivers}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Text style={{ fontSize: 40 }}>👤</Text>
                <Text style={[s.emptyText, { color: subtextColor }]}>No drivers found</Text>
              </View>
            }
            renderItem={({ item }) => {
              const statusC = driverStatusColor(item.approval_status);
              const statusL = driverStatusLabel(item.approval_status);
              return (
                <View style={[s.driverCard, { backgroundColor: cardBg, borderColor }]}>
                  <View style={s.driverTop}>
                    <Image
                      source={{ uri: driverPhotoUrl(item.id) }}
                      style={s.driverPhoto}
                      defaultSource={require('../assets/images/icon.png')}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[s.driverName, { color: textColor }]}>{item.full_name || 'Unknown Driver'}</Text>
                      <Text style={[s.driverMeta, { color: subtextColor }]}>
                        {vehicleIcon(item.vehicle_type)} {item.vehicle_type || 'Unknown'}{item.vehicle_label ? ` · ${item.vehicle_label}` : ''}
                      </Text>
                      <Text style={[s.driverMeta, { color: subtextColor }]}>
                        ⭐ {item.average_rating ? Number(item.average_rating).toFixed(1) : 'N/A'}  ·  {item.trips_completed || 0} trips
                      </Text>
                      <Text style={[s.driverMeta, { color: subtextColor }]}>
                        📞 {formatPhone(item.phone) || 'No phone'}
                      </Text>
                    </View>
                    <StatusBadge color={statusC} label={statusL} />
                  </View>

                  {/* Action buttons */}
                  <View style={[s.driverActions, { borderTopColor: borderColor }]}>
                    {/* Details button */}
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: darkMode ? '#1E293B' : '#F8FAFC' }]}
                      onPress={() => router.push(`/admin-driver/${item.id}` as never)}
                    >
                      <Text style={[s.actionBtnText, { color: GOLD }]}>📋 Details</Text>
                    </Pressable>

                    {/* Approve (for pending/suspended/rejected) */}
                    {item.approval_status !== 'approved' && (
                      <Pressable
                        style={[s.actionBtn, { backgroundColor: '#F0FDF4', borderLeftWidth: 1, borderLeftColor: borderColor }]}
                        onPress={() => setDriverStatus(item.id, 'approved')}
                      >
                        <Text style={[s.actionBtnText, { color: GREEN }]}>✓ Approve</Text>
                      </Pressable>
                    )}


                    {/* Ban / Unban */}
                    {(() => {
                      const isBanned = item.approval_status === 'suspended' || item.approval_status === 'rejected';
                      return (
                        <Pressable
                          style={[s.actionBtn, {
                            backgroundColor: isBanned ? '#F0FDF4' : '#FEF2F2',
                            borderLeftWidth: 1, borderLeftColor: borderColor,
                          }]}
                          onPress={() => {
                            if (isBanned) {
                              Alert.alert('Unban Driver', `Unban ${item.full_name || 'this driver'}?`, [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Unban', onPress: () => setDriverStatus(item.id, 'approved') },
                              ]);
                            } else {
                              promptBan(item);
                            }
                          }}
                        >
                          <Text style={[s.actionBtnText, { color: isBanned ? GREEN : RED }]}>
                            {isBanned ? '↺ Unban' : '🚫 Ban'}
                          </Text>
                        </Pressable>
                      );
                    })()}
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    );
  }, [driversLoading, filteredDrivers, driverFilter, driverSearch, cardBg, textColor, subtextColor, borderColor, darkMode]);

  // ─── Tab: Rides ───────────────────────────────────────────────────────────
  const renderRides = useCallback(() => {
    return (
      <View style={{ flex: 1 }}>
        {/* Header row with filter + clear button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <FilterRow
              options={[
                { key: 'active'    as RideFilter, label: 'Active' },
                { key: 'completed' as RideFilter, label: 'Completed' },
                { key: 'cancelled' as RideFilter, label: 'Cancelled' },
              ]}
              active={rideFilter}
              onSelect={(f: RideFilter) => { ridesClearedRef.current = false; rideFilterRef.current = f; setRideFilter(f); loadRides(false, f); }}
              cardBg={cardBg} borderColor={borderColor} subtextColor={subtextColor}
            />
          </View>
          <Pressable
            onPress={clearRides}
            style={{ backgroundColor: cardBg, borderWidth: 1, borderColor, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 }}
          >
            <Text style={{ color: RED, fontWeight: '800', fontSize: 12 }}>🗑 Clear</Text>
          </Pressable>
        </View>

        {ridesLoading ? (
          <View style={{ gap: 10, paddingTop: 4 }}>
            {[1,2,3,4].map(i => <Skeleton key={i} width="100%" height={110} radius={16} />)}
          </View>
        ) : (
          <FlatList
            data={rides}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Text style={{ fontSize: 40 }}>🚕</Text>
                <Text style={[s.emptyText, { color: subtextColor }]}>No rides found</Text>
              </View>
            }
            renderItem={({ item }) => {
              const driverName  = item.driver?.full_name    || 'No driver';
              const riderName   = item.passenger?.full_name || 'No rider';
              const dlvLabel    = deliveryLabel(item);
              const typeLabel   = dlvLabel || (item.service === 'delivery' ? '🚚 Delivery' : '🚗 Ride');
              const vehicleType = item.driver?.vehicle_type || '';
              return (
                <View style={[s.rideCard, { backgroundColor: cardBg, borderColor }]}>
                  <View style={s.rideHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.rideId, { color: subtextColor }]}>#{item.id.slice(0, 8).toUpperCase()}</Text>
                      {vehicleType ? (
                        <Text style={{ fontSize: 11, color: subtextColor, fontWeight: '700' }}>
                          {vehicleIcon(vehicleType)} {vehicleType}
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge color={rideStatusColor(item.status)} label={rideStatusLabel(item.status)} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
                    <Text style={[s.rideSub, { color: textColor, flex: 1 }]} numberOfLines={1}>🏍 {driverName}</Text>
                    <Text style={[s.rideSub, { color: textColor, flex: 1 }]} numberOfLines={1}>👤 {riderName}</Text>
                  </View>
                  <View style={s.rideMeta}>
                    <Text style={[s.rideSub, { color: subtextColor }]}>
                      {typeLabel}{item.price ? `  ·  ${Number(item.price).toLocaleString()} L.L` : ''}
                    </Text>
                    <Text style={[s.rideSub, { color: subtextColor }]}>{timeAgo(item.created_at)}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    );
  }, [ridesLoading, rides, rideFilter, cardBg, textColor, subtextColor, borderColor, darkMode]);

  // ─── Tab: Earnings ────────────────────────────────────────────────────────
  const renderEarnings = useCallback(() => {
    if (earningsLoading) {
      return (
        <View style={{ paddingTop: 12, gap: 10 }}>
          {[1,2,3].map(i => <Skeleton key={i} width="100%" height={90} radius={16} />)}
        </View>
      );
    }

    const sorted        = [...driverEarnings].sort((a, b) => b.total - a.total);

    // ── Split totals by vehicle type ──
    const motoDrivers   = driverEarnings.filter(d => d.vehicle_type === 'Motorcycle');
    const tuktukDrivers = driverEarnings.filter(d => d.vehicle_type === 'Tuktuk');
    const carDrivers    = driverEarnings.filter(d => d.vehicle_type === 'Car');
    const motoTotal     = motoDrivers.reduce((s, d) => s + d.total, 0);
    const tuktukTotal   = tuktukDrivers.reduce((s, d) => s + d.total, 0);
    const carTotal      = carDrivers.reduce((s, d) => s + d.total, 0);
    const motoCommission   = Math.round(motoTotal   * 0.10);
    const tuktukCommission = Math.round(tuktukTotal * 0.12);
    const carCommission    = Math.round(carTotal    * 0.15);

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Clear button */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Pressable
            onPress={() => { earningsClearedRef.current = true; setDriverEarnings([]); setTodayRev(0); setWeekRev(0); setTotalCommission(0); }}
            style={{ backgroundColor: cardBg, borderWidth: 1, borderColor, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 }}
          >
            <Text style={{ color: RED, fontWeight: '800', fontSize: 12 }}>🗑 Clear</Text>
          </Pressable>
        </View>

        {/* Today / Week overview */}
        <View style={s.statsRow}>
          <StatCard icon="☀️" value={todayRev > 0 ? todayRev.toLocaleString() : '0'} label="Today (L.L)"     accent={GOLD}  cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
          <StatCard icon="📅" value={weekRev  > 0 ? weekRev.toLocaleString()  : '0'} label="This Week (L.L)" accent={GREEN} cardBg={cardBg} textColor={textColor} subtextColor={subtextColor} />
        </View>

        {/* ── Motorcycle block ── */}
        <Text style={[s.sectionTitle, { color: textColor, marginTop: 8 }]}>🏍 Motorcycle Earnings</Text>
        <View style={s.statsRow}>
          <StatCard
            icon="🏍"
            value={motoTotal > 0 ? motoTotal.toLocaleString() : '0'}
            label="Moto Total (L.L)"
            accent={GOLD}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
          <StatCard
            icon="🏦"
            value={motoCommission > 0 ? motoCommission.toLocaleString() : '0'}
            label="Moto Commission 10% (L.L)"
            accent={ORANGE}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
        </View>

        {/* ── Tuktuk block ── */}
        <Text style={[s.sectionTitle, { color: textColor, marginTop: 4 }]}>🛺 Tuktuk Earnings</Text>
        <View style={s.statsRow}>
          <StatCard
            icon="🛺"
            value={tuktukTotal > 0 ? tuktukTotal.toLocaleString() : '0'}
            label="Tuktuk Total (L.L)"
            accent={GOLD}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
          <StatCard
            icon="🏦"
            value={tuktukCommission > 0 ? tuktukCommission.toLocaleString() : '0'}
            label="Tuktuk Commission 12% (L.L)"
            accent={ORANGE}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
        </View>

        {/* ── Car block ── */}
        <Text style={[s.sectionTitle, { color: textColor, marginTop: 4 }]}>🚗 Car Earnings</Text>
        <View style={s.statsRow}>
          <StatCard
            icon="🚗"
            value={carTotal > 0 ? carTotal.toLocaleString() : '0'}
            label="Car Total (L.L)"
            accent={GOLD}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
          <StatCard
            icon="🏦"
            value={carCommission > 0 ? carCommission.toLocaleString() : '0'}
            label="Car Commission 15% (L.L)"
            accent={ORANGE}
            cardBg={cardBg} textColor={textColor} subtextColor={subtextColor}
          />
        </View>

        <Text style={[s.sectionTitle, { color: textColor, marginTop: 8 }]}>
          Driver Breakdown ({sorted.length})
        </Text>

        {earningsLoading ? (
          <View style={{ gap: 10 }}>
            {[1,2,3].map(i => <View key={i} style={{ height: 80, borderRadius: 16, backgroundColor: borderColor, opacity: 0.3 }} />)}
          </View>
        ) : sorted.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={{ fontSize: 36 }}>👤</Text>
            <Text style={[s.emptyText, { color: subtextColor }]}>No drivers registered yet</Text>
          </View>
        ) : sorted.map(driver => {
          const rate = COMMISSION[driver.vehicle_type] || 0.10;
          return (
            <View key={driver.id} style={[s.driverCard, { backgroundColor: cardBg, borderColor }]}>
              <View style={s.driverTop}>
                <Image
                  source={{ uri: driverPhotoUrl(driver.id) }}
                  style={[s.driverPhoto, { width: 46, height: 46, borderRadius: 23 }]}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[s.driverName, { color: textColor }]}>{driver.full_name || 'Unknown'}</Text>
                  <Text style={[s.driverMeta, { color: subtextColor }]}>
                    {vehicleIcon(driver.vehicle_type)} {driver.vehicle_type}  ·  {driver.totalTrips} trip{driver.totalTrips !== 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: driver.total > 0 ? GREEN : subtextColor }}>
                    {driver.total > 0 ? driver.total.toLocaleString() : '—'}
                  </Text>
                  <Text style={{ fontSize: 10, color: subtextColor, fontWeight: '600' }}>L.L total</Text>
                </View>
              </View>

              {driver.total > 0 && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ alignItems: 'center', flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '900', color: GREEN }}>{driver.payout.toLocaleString()}</Text>
                      <Text style={{ fontSize: 10, color: subtextColor, fontWeight: '600' }}>Driver Payout</Text>
                    </View>
                    <View style={{ width: 1, backgroundColor: borderColor }} />
                    <View style={{ alignItems: 'center', flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '900', color: ORANGE }}>{driver.commission.toLocaleString()}</Text>
                      <Text style={{ fontSize: 10, color: subtextColor, fontWeight: '600' }}>Commission ({Math.round(rate * 100)}%)</Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={[s.driverActions, { borderTopColor: borderColor }]}>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: darkMode ? '#1E293B' : '#F8FAFC' }]}
                  onPress={() => router.push(`/admin-driver/${driver.id}` as never)}
                >
                  <Text style={[s.actionBtnText, { color: GOLD }]}>📋 Details</Text>
                </Pressable>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: darkMode ? '#374151' : '#F3F4F6', borderLeftWidth: 1, borderLeftColor: borderColor }]}
                  onPress={() => clearDriverEarnings(driver.id, driver.full_name)}
                >
                  <Text style={[s.actionBtnText, { color: driver.total > 0 ? RED : subtextColor }]}>🗑 Clear</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  }, [earningsLoading, driverEarnings, todayRev, weekRev, totalCommission, cardBg, textColor, subtextColor, borderColor, darkMode]);

  // ─── Tab: Notify (broadcast push notifications) ──────────────────────────────
  const renderReports = useCallback(() => {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[s.sectionTitle, { color: textColor, marginBottom: 4 }]}>📣 Send a Notification</Text>
          <Text style={{ color: subtextColor, fontSize: 12, marginBottom: 16 }}>
            Push a message to your users' phones.
          </Text>

          {/* Audience picker */}
          <Text style={[nf.fieldLabel, { color: subtextColor }]}>Audience</Text>
          <FilterRow
            options={[
              { key: 'all'     as NotifyAudience, label: 'Everyone' },
              { key: 'drivers' as NotifyAudience, label: 'Drivers' },
              { key: 'riders'  as NotifyAudience, label: 'Riders' },
            ]}
            active={notifyAudience}
            onSelect={(a: NotifyAudience) => setNotifyAudience(a)}
            cardBg={cardBg} borderColor={borderColor} subtextColor={subtextColor}
          />

          {/* Title */}
          <Text style={[nf.fieldLabel, { color: subtextColor }]}>Title (optional)</Text>
          <TextInput
            value={notifyTitle}
            onChangeText={setNotifyTitle}
            placeholder="Wasl"
            placeholderTextColor={subtextColor}
            maxLength={80}
            style={[nf.input, { backgroundColor: bg, borderColor, color: textColor }]}
          />

          {/* Message */}
          <Text style={[nf.fieldLabel, { color: subtextColor }]}>Message</Text>
          <TextInput
            value={notifyBody}
            onChangeText={setNotifyBody}
            placeholder="Type your message here..."
            placeholderTextColor={subtextColor}
            multiline
            maxLength={240}
            style={[nf.input, { backgroundColor: bg, borderColor, color: textColor, height: 100, textAlignVertical: 'top' }]}
          />
          <Text style={{ color: subtextColor, fontSize: 11, textAlign: 'right', marginTop: 4 }}>
            {notifyBody.length}/240
          </Text>

          {/* Send */}
          <Pressable
            onPress={sendBroadcast}
            disabled={notifySending}
            style={[nf.sendBtn, { backgroundColor: GOLD, opacity: notifySending ? 0.6 : 1, marginTop: 12 }]}
          >
            {notifySending
              ? <ActivityIndicator color="#000" />
              : <Text style={{ color: '#000', fontWeight: '900', fontSize: 15 }}>Send Notification</Text>}
          </Pressable>
        </View>

        <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={{ color: subtextColor, fontSize: 12, lineHeight: 18 }}>
            Only users who have opened the app and allowed notifications will receive the message.
            Notifications don't appear on the Expo Go app — use a development or production build.
          </Text>
        </View>
      </ScrollView>
    );
  }, [cardBg, textColor, subtextColor, borderColor, bg, notifyTitle, notifyBody, notifyAudience, notifySending]);

  // ─── Bottom Nav ────────────────────────────────────────────────────────────
  const TABS: { key: Tab; icon: string; label: string; badge?: number }[] = [
    { key: 'dashboard', icon: '📊', label: 'Dashboard' },
    { key: 'drivers',   icon: '👤', label: 'Drivers',  badge: stats.pendingDrivers },
    { key: 'rides',     icon: '🚕', label: 'Rides',    badge: stats.activeRides },
    { key: 'earnings',  icon: '💰', label: 'Earnings' },
    { key: 'reports',   icon: '📣', label: 'Notify' },
  ];

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 22 }}>🛡️</Text>
          <View>
            <Text style={[s.headerTitle, { color: textColor }]}>Admin Panel</Text>
            <Text style={[s.headerSub, { color: subtextColor }]}>{TABS.find(t => t.key === activeTab)?.label}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable onPress={() => {
            // Refresh whichever tab is currently active, and reset any cleared state
            ridesClearedRef.current = false;
            earningsClearedRef.current = false;
            const tab = activeTabRef.current;
            if (tab === 'dashboard') loadDashboard();
            else if (tab === 'drivers')  loadDrivers(false, driverFilterRef.current);
            else if (tab === 'rides')    loadRides(false, rideFilterRef.current);
            else if (tab === 'earnings') loadEarnings();
          }} hitSlop={8}>
            <Text style={{ color: GOLD, fontWeight: '800', fontSize: 20 }}>↻</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: subtextColor, fontWeight: '700', fontSize: 15 }}>✕</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'drivers'   && renderDrivers()}
        {activeTab === 'rides'     && renderRides()}
        {activeTab === 'earnings'  && renderEarnings()}
        {activeTab === 'reports'   && renderReports()}
      </View>

      <View style={[s.bottomNav, { backgroundColor: cardBg, borderTopColor: borderColor }]}>
        {TABS.map(tab => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={s.navItem}>
              {isActive && <View style={[s.navIndicator, { backgroundColor: GOLD }]} />}
              <View style={{ position: 'relative' }}>
                <Text style={{ fontSize: 18 }}>{tab.icon}</Text>
                {tab.badge != null && tab.badge > 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{tab.badge > 99 ? '99+' : tab.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[s.navLabel, { color: isActive ? GOLD : subtextColor }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ─── BAN MESSAGE MODAL ─── */}
      <Modal visible={!!banTarget} transparent animationType="fade" onRequestClose={() => setBanTarget(null)}>
        <View style={banM.overlay}>
          <View style={[banM.card, { backgroundColor: cardBg }]}>
            <Text style={[banM.title, { color: textColor }]}>
              Ban {banTarget?.full_name || 'this driver'}
            </Text>
            <Text style={[banM.sub, { color: subtextColor }]}>
              Type a message the driver will see when they try to go online (optional).
            </Text>
            <TextInput
              style={[banM.input, { color: textColor, borderColor, backgroundColor: bg }]}
              placeholder="e.g. Pay your fees to continue driving"
              placeholderTextColor={subtextColor}
              value={banText}
              onChangeText={setBanText}
              multiline
            />
            <View style={banM.row}>
              <Pressable style={[banM.btn, { backgroundColor: borderColor }]} onPress={() => setBanTarget(null)}>
                <Text style={[banM.btnText, { color: textColor }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[banM.btn, { backgroundColor: RED }]}
                onPress={() => {
                  const target = banTarget;
                  const msg = banText;
                  setBanTarget(null);
                  if (target) setDriverStatus(target.id, 'suspended', msg);
                }}
              >
                <Text style={[banM.btnText, { color: '#fff' }]}>🚫 Ban</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── DIRECT MESSAGE MODAL ─── */}
      <Modal visible={!!msgTarget} transparent animationType="fade" onRequestClose={() => setMsgTarget(null)}>
        <View style={banM.overlay}>
          <View style={[banM.card, { backgroundColor: cardBg }]}>
            <Text style={[banM.title, { color: textColor }]}>
              Message {msgTarget?.full_name || 'this user'}
            </Text>
            <Text style={[banM.sub, { color: subtextColor }]}>
              This goes straight to their notification inbox.
            </Text>
            <TextInput
              style={[banM.input, { color: textColor, borderColor, backgroundColor: bg }]}
              placeholder="Type your message…"
              placeholderTextColor={subtextColor}
              value={msgText}
              onChangeText={setMsgText}
              multiline
            />
            <View style={banM.row}>
              <Pressable style={[banM.btn, { backgroundColor: borderColor }]} onPress={() => setMsgTarget(null)}>
                <Text style={[banM.btnText, { color: textColor }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[banM.btn, { backgroundColor: GOLD }]} onPress={sendDirectMessage}>
                <Text style={[banM.btnText, { color: '#111827' }]}>✉️ Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const banM = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 16, padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80, fontSize: 15, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12, marginTop: 4 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '700' },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:   { flex: 1, paddingTop: 56 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 16 },
  headerTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, fontWeight: '600', marginTop: 1 },
  statsRow:    { flexDirection: 'row' },
  sectionTitle:{ fontSize: 14, fontWeight: '800', marginBottom: 10, marginLeft: 4, letterSpacing: 0.2 },
  card:        { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  activityRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  activityIcon:{ fontSize: 18, width: 28, textAlign: 'center' },
  activityText:{ fontSize: 13, fontWeight: '600' },
  activityTime:{ fontSize: 11, marginTop: 2 },
  searchBar:   { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '500' },
  driverCard:        { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  driverTop:         { flexDirection: 'row', padding: 14, alignItems: 'flex-start' },
  driverPhoto:       { width: 58, height: 58, borderRadius: 29, backgroundColor: '#E5E7EB' },
  driverName:        { fontSize: 15, fontWeight: '900', marginBottom: 4 },
  driverMeta:        { fontSize: 12, fontWeight: '500', marginBottom: 2 },
  driverActions:     { flexDirection: 'row', borderTopWidth: 1 },
  actionBtn:         { flex: 1, paddingVertical: 13, alignItems: 'center' },
  actionBtnTextWhite:{ color: '#fff', fontWeight: '800', fontSize: 13 },
  actionBtnText:     { fontWeight: '800', fontSize: 13 },
  rideCard:    { borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  rideHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rideId:      { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  rideSub:     { fontSize: 12, fontWeight: '500' },
  rideMeta:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E2E8F020' },
  reportCard:   { borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reportType:   { fontSize: 14, fontWeight: '800' },
  reportDesc:   { fontSize: 13, fontWeight: '500', marginBottom: 6, lineHeight: 18 },
  reportTime:   { fontSize: 11, fontWeight: '500' },
  emptyWrap:   { alignItems: 'center', justifyContent: 'center', paddingTop: 64, gap: 12 },
  emptyText:   { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  bottomNav:   { flexDirection: 'row', borderTopWidth: 1, paddingBottom: 30, paddingTop: 10 },
  navItem:     { flex: 1, alignItems: 'center', gap: 3, position: 'relative' },
  navIndicator:{ position: 'absolute', top: -10, width: 28, height: 3, borderRadius: 2 },
  navLabel:    { fontSize: 10, fontWeight: '700' },
  badge:       { position: 'absolute', top: -5, right: -8, backgroundColor: RED, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:   { color: '#fff', fontSize: 9, fontWeight: '900' },
});

// ─── Notify (broadcast) styles ──────────────────────────────────────────────────
const nf = StyleSheet.create({
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 10 },
  input:      { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '500' },
  sendBtn:    { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
});
