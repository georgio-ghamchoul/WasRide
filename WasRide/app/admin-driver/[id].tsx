import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Alert, Image, ActivityIndicator, FlatList,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function vehicleIcon(type: string) { return type === 'Tuktuk' ? '🛺' : type === 'Car' ? '🚗' : '🏍'; }
function formatPhone(phone: string) {
  if (!phone) return '';
  if (phone.startsWith('+961')) return '+961 ' + phone.slice(4);
  return phone;
}
function timeAgo(iso: string) {
  if (!iso) return '—';
  const utc  = /[Z+]/.test(iso) ? iso : iso + 'Z';
  const diff = Date.now() - new Date(utc).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function statusColor(status: string) {
  switch (status) {
    case 'approved':  return GREEN;
    case 'pending':   return YELLOW;
    case 'suspended': return ORANGE;
    case 'rejected':  return RED;
    default:          return '#94A3B8';
  }
}
function statusLabel(status: string) {
  switch (status) {
    case 'approved':  return 'Active';
    case 'pending':   return 'Pending';
    case 'suspended': return 'Suspended';
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
    default:              return GOLD;
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

// ─── Sub-components ───────────────────────────────────────────────────────────
function Skeleton({ width, height, radius = 8 }: { width: any; height: number; radius?: number }) {
  return <View style={{ width, height, borderRadius: radius, backgroundColor: '#374151', opacity: 0.2 }} />;
}
function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <View style={[bd.wrap, { backgroundColor: color + '22' }]}>
      <View style={[bd.dot, { backgroundColor: color }]} />
      <Text style={[bd.text, { color }]}>{label}</Text>
    </View>
  );
}
const bd = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  dot:  { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: '800' },
});

function StatBlock({ icon, value, label, color }: { icon: string; value: string | number; label: string; color?: string }) {
  return (
    <View style={sb.wrap}>
      <Text style={sb.icon}>{icon}</Text>
      <Text style={[sb.value, color ? { color } : {}]}>{value}</Text>
      <Text style={sb.label}>{label}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:  { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 4 },
  icon:  { fontSize: 20 },
  value: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  label: { fontSize: 10, fontWeight: '600', color: '#64748B', textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminDriverDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const { darkMode } = useAppState();

  const bg           = darkMode ? '#0F172A' : '#F1F5F9';
  const cardBg       = darkMode ? '#1E293B' : '#FFFFFF';
  const textColor    = darkMode ? '#F1F5F9' : '#0F172A';
  const subtextColor = darkMode ? '#94A3B8' : '#64748B';
  const borderColor  = darkMode ? '#334155' : '#E2E8F0';

  const [loading, setLoading]         = useState(true);
  const [driver, setDriver]           = useState<any>(null);
  const [rides, setRides]             = useState<any[]>([]);
  const [stats, setStats]             = useState({ completed: 0, cancelled: 0, totalEarned: 0, commission: 0, payout: 0 });
  const [imgErrors, setImgErrors]     = useState<Record<string, boolean>>({});

  // Edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName]       = useState('');
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (id) loadDriver();
  }, [id]);

  const storage = (path: string) =>
    supabase.storage.from('driver-images').getPublicUrl(path).data.publicUrl;

  const photos = {
    profile: storage(`drivers/${id}.jpg`),
    vehicle: storage(`vehicles/${id}.jpg`),
    idFront: storage(`drivers/id-front-${id}.jpg`),
    idBack:  storage(`drivers/id-back-${id}.jpg`),
    selfie:  storage(`drivers/selfie-${id}.jpg`),
    licenseFront: storage(`drivers/license-front-${id}.jpg`),
    licenseBack:  storage(`drivers/license-back-${id}.jpg`),
  };

  async function loadDriver() {
    setLoading(true);
    try {
      // Load profile
      const { data: profile, error: profErr } = await supabase
        .from('profiles').select('*').eq('id', id).maybeSingle();
      if (profErr) { console.log('profile error:', profErr.message); }
      setDriver(profile);

      // Load all rides by this driver
      const { data: ridesData, error: ridesErr } = await supabase
        .from('rides')
        .select('id, status, price, created_at, passenger_id, pickup_lat, pickup_lng')
        .eq('driver_id', id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (ridesErr) console.log('rides error:', ridesErr.message);

      const ridesArr = ridesData || [];
      setRides(ridesArr);

      // Compute stats
      const completed  = ridesArr.filter(r => r.status === 'completed').length;
      const cancelled  = ridesArr.filter(r => r.status === 'cancelled').length;
      const totalEarned = ridesArr
        .filter(r => r.status === 'completed')
        .reduce((s, r) => s + (Number(r.price) || 0), 0);
      const rate       = COMMISSION[profile?.vehicle_type] || 0.10;
      const commission = Math.round(totalEarned * rate);
      const payout     = Math.round(totalEarned * (1 - rate));
      setStats({ completed, cancelled, totalEarned, commission, payout });
    } catch (e: any) { console.log('loadDriver error:', e?.message); }
    setLoading(false);
  }

  async function updateStatus(newStatus: string) {
    const { error } = await supabase.from('profiles')
      .update({ approval_status: newStatus }).eq('id', id);
    if (error) { Alert.alert('Error', error.message); return; }
    if (newStatus === 'rejected' || newStatus === 'suspended') {
      await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', id);
    }
    loadDriver();
  }

  function showActions() {
    if (!driver) return;
    const status = driver.approval_status;
    const name   = driver.full_name || 'this driver';
    const buttons: any[] = [];
    if (status !== 'approved')  buttons.push({ text: '✓ Approve',    onPress: () => updateStatus('approved') });
    if (status !== 'suspended') buttons.push({ text: '⏸ Suspend',    onPress: () => updateStatus('suspended') });
    if (status !== 'rejected')  buttons.push({ text: '🚫 Ban',       style: 'destructive', onPress: () => updateStatus('rejected') });
    if (status === 'rejected' || status === 'suspended')
      buttons.push({ text: '↺ Reactivate', onPress: () => updateStatus('approved') });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`Driver: ${name}`, `Status: ${statusLabel(status)}`, buttons);
  }

  function openEdit() {
    setEditName(driver?.full_name || '');
    setEditVisible(true);
  }

  async function saveProfile() {
    const name = editName.trim();
    if (!name) { Alert.alert('Error', 'Full name cannot be empty.'); return; }
    setSaving(true);
    const { error } = await supabase.from('profiles')
      .update({ full_name: name }).eq('id', id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setEditVisible(false);
    loadDriver();
  }

  const cancellationRate = stats.completed + stats.cancelled > 0
    ? Math.round((stats.cancelled / (stats.completed + stats.cancelled)) * 100)
    : 0;
  const rate = COMMISSION[driver?.vehicle_type] || 0.10;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
            <Text style={{ color: GOLD, fontSize: 20, fontWeight: '800' }}>←</Text>
          </Pressable>
          <Skeleton width={160} height={22} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <Skeleton width="100%" height={200} radius={20} />
          <Skeleton width="100%" height={100} radius={16} />
          <Skeleton width="100%" height={120} radius={16} />
        </View>
      </View>
    );
  }

  if (!driver) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40 }}>❓</Text>
        <Text style={{ color: subtextColor, marginTop: 12, fontSize: 15 }}>Driver not found</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 20, padding: 16 }}>
          <Text style={{ color: GOLD, fontWeight: '800', fontSize: 15 }}>← Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const sColor = statusColor(driver.approval_status);
  const sLabel = statusLabel(driver.approval_status);

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* Header */}
      <View style={[ds.header, { backgroundColor: cardBg, borderBottomColor: borderColor }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: GOLD, fontSize: 20, fontWeight: '800' }}>←</Text>
        </Pressable>
        <Text style={[ds.headerTitle, { color: textColor }]} numberOfLines={1}>
          {driver.full_name || 'Driver Details'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={openEdit} style={[ds.actionChip, { backgroundColor: GOLD + '22' }]}>
            <Text style={{ color: GOLD, fontWeight: '800', fontSize: 12 }}>✏️ Edit</Text>
          </Pressable>
          <Pressable onPress={showActions} style={[ds.actionChip, { backgroundColor: sColor + '22' }]}>
            <Text style={{ color: sColor, fontWeight: '800', fontSize: 12 }}>{sLabel} ▾</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

        {/* Profile Card */}
        <View style={[ds.profileCard, { backgroundColor: cardBg, borderColor }]}>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            {!imgErrors['profile'] ? (
              <Image
                source={{ uri: photos.profile }}
                style={ds.profilePhoto}
                onError={() => setImgErrors(e => ({ ...e, profile: true }))}
              />
            ) : (
              <View style={[ds.profilePhoto, { backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 48, fontWeight: '900', color: '#94A3B8' }}>
                  {(driver.full_name || '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[ds.profileName, { color: textColor }]}>{driver.full_name || 'Unknown Driver'}</Text>
            <StatusBadge color={sColor} label={sLabel} />
          </View>

          <View style={[ds.infoGrid, { borderTopColor: borderColor }]}>
            <View style={ds.infoRow}>
              <Text style={[ds.infoLabel, { color: subtextColor }]}>Phone</Text>
              <Text style={[ds.infoValue, { color: textColor }]}>{formatPhone(driver.phone) || '—'}</Text>
            </View>
            <View style={[ds.infoRow, { borderTopColor: borderColor, borderTopWidth: 1 }]}>
              <Text style={[ds.infoLabel, { color: subtextColor }]}>Vehicle</Text>
              <Text style={[ds.infoValue, { color: textColor }]}>
                {vehicleIcon(driver.vehicle_type)} {driver.vehicle_type || '—'}{driver.vehicle_label ? ` · ${driver.vehicle_label}` : ''}
              </Text>
            </View>
            <View style={[ds.infoRow, { borderTopColor: borderColor, borderTopWidth: 1 }]}>
              <Text style={[ds.infoLabel, { color: subtextColor }]}>Rating</Text>
              <Text style={[ds.infoValue, { color: textColor }]}>
                ⭐ {driver.average_rating ? Number(driver.average_rating).toFixed(1) : 'N/A'}
              </Text>
            </View>
            <View style={[ds.infoRow, { borderTopColor: borderColor, borderTopWidth: 1 }]}>
              <Text style={[ds.infoLabel, { color: subtextColor }]}>Joined</Text>
              <Text style={[ds.infoValue, { color: textColor }]}>{timeAgo(driver.created_at)}</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={ds.actionRow}>
          {driver.approval_status !== 'approved' && (
            <Pressable style={[ds.btn, { backgroundColor: GREEN }]} onPress={() => updateStatus('approved')}>
              <Text style={ds.btnText}>✓ Approve</Text>
            </Pressable>
          )}
          {driver.approval_status === 'approved' && (
            <Pressable style={[ds.btn, { backgroundColor: ORANGE }]} onPress={() => {
              Alert.alert('Suspend Driver', `Suspend ${driver.full_name || 'this driver'}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Suspend', style: 'destructive', onPress: () => updateStatus('suspended') },
              ]);
            }}>
              <Text style={ds.btnText}>⏸ Suspend</Text>
            </Pressable>
          )}
          {driver.approval_status !== 'rejected' ? (
            <Pressable style={[ds.btn, { backgroundColor: RED }]} onPress={() => {
              Alert.alert('Ban Driver', `Ban ${driver.full_name || 'this driver'}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Ban', style: 'destructive', onPress: () => updateStatus('rejected') },
              ]);
            }}>
              <Text style={ds.btnText}>🚫 Ban</Text>
            </Pressable>
          ) : (
            <Pressable style={[ds.btn, { backgroundColor: GREEN }]} onPress={() => updateStatus('approved')}>
              <Text style={ds.btnText}>↺ Unban</Text>
            </Pressable>
          )}
        </View>

        {/* Stats */}
        <View style={[ds.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[ds.sectionTitle, { color: textColor }]}>Trip Statistics</Text>
          <View style={ds.statsGrid}>
            <StatBlock icon="✅" value={stats.completed}   label="Completed"   color={GREEN}  />
            <View style={{ width: 1, backgroundColor: borderColor }} />
            <StatBlock icon="🚫" value={stats.cancelled}   label="Cancelled"   color={RED}    />
            <View style={{ width: 1, backgroundColor: borderColor }} />
            <StatBlock icon="📊" value={cancellationRate + '%'} label="Cancel Rate" color={cancellationRate > 30 ? RED : textColor} />
          </View>
        </View>

        {/* Earnings */}
        <View style={[ds.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[ds.sectionTitle, { color: textColor }]}>Earnings & Commission</Text>
          <View style={ds.statsGrid}>
            <StatBlock icon="💰" value={stats.totalEarned > 0 ? stats.totalEarned.toLocaleString() : '0'} label="Total (L.L)" color={GREEN} />
            <View style={{ width: 1, backgroundColor: borderColor }} />
            <StatBlock icon="🏦" value={stats.commission > 0 ? stats.commission.toLocaleString() : '0'} label={`Commission (${Math.round(rate * 100)}%)`} color={ORANGE} />
            <View style={{ width: 1, backgroundColor: borderColor }} />
            <StatBlock icon="👤" value={stats.payout > 0 ? stats.payout.toLocaleString() : '0'} label="Driver Payout" color={textColor} />
          </View>
        </View>

        {/* Vehicle Photo */}
        <Text style={[ds.sectionTitle, { color: textColor }]}>Vehicle Photo</Text>
        <View style={[ds.card, { backgroundColor: cardBg, borderColor, padding: 0, overflow: 'hidden' }]}>
          {!imgErrors['vehicle'] ? (
            <Image
              source={{ uri: photos.vehicle }}
              style={ds.vehiclePhoto}
              resizeMode="cover"
              onError={() => setImgErrors(e => ({ ...e, vehicle: true }))}
            />
          ) : (
            <View style={[ds.vehiclePhoto, { backgroundColor: borderColor, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontSize: 32 }}>🚗</Text>
              <Text style={{ color: subtextColor, fontSize: 12, marginTop: 6 }}>No vehicle photo</Text>
            </View>
          )}
        </View>

        {/* Documents */}
        <Text style={[ds.sectionTitle, { color: textColor }]}>Documents</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { key: 'idFront', label: 'ID Front', uri: photos.idFront },
            { key: 'idBack',  label: 'ID Back',  uri: photos.idBack },
            { key: 'selfie',  label: 'Selfie',   uri: photos.selfie },
          ].map(doc => (
            <View key={doc.key} style={{ flex: 1 }}>
              {!imgErrors[doc.key] ? (
                <Image
                  source={{ uri: doc.uri }}
                  style={ds.docPhoto}
                  resizeMode="cover"
                  onError={() => setImgErrors(e => ({ ...e, [doc.key]: true }))}
                />
              ) : (
                <View style={[ds.docPhoto, { backgroundColor: borderColor, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 20 }}>📄</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, fontWeight: '700', color: subtextColor, textAlign: 'center', marginTop: 4 }}>
                {doc.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Driver's License */}
        <Text style={[ds.sectionTitle, { color: textColor }]}>Driver's License</Text>
        {driver?.license_number ? (
          <Text style={{ color: textColor, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>
            No: {driver.license_number}
          </Text>
        ) : (
          <Text style={{ color: subtextColor, fontSize: 12, marginBottom: 8 }}>No license number</Text>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { key: 'licenseFront', label: 'License Front', uri: photos.licenseFront },
            { key: 'licenseBack',  label: 'License Back',  uri: photos.licenseBack },
          ].map(doc => (
            <View key={doc.key} style={{ flex: 1 }}>
              {!imgErrors[doc.key] ? (
                <Image
                  source={{ uri: doc.uri }}
                  style={ds.docPhoto}
                  resizeMode="cover"
                  onError={() => setImgErrors(e => ({ ...e, [doc.key]: true }))}
                />
              ) : (
                <View style={[ds.docPhoto, { backgroundColor: borderColor, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 20 }}>📄</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, fontWeight: '700', color: subtextColor, textAlign: 'center', marginTop: 4 }}>
                {doc.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Recent Rides */}
        <Text style={[ds.sectionTitle, { color: textColor }]}>Recent Rides ({rides.length})</Text>
        {rides.length === 0 ? (
          <View style={[ds.card, { backgroundColor: cardBg, borderColor, alignItems: 'center', padding: 24 }]}>
            <Text style={{ fontSize: 32 }}>🚕</Text>
            <Text style={{ color: subtextColor, marginTop: 8, fontWeight: '600' }}>No rides yet</Text>
          </View>
        ) : (
          rides.slice(0, 20).map(ride => (
            <View key={ride.id} style={[ds.rideRow, { backgroundColor: cardBg, borderColor }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: subtextColor, fontFamily: 'monospace' }}>
                  #{ride.id.slice(0, 8).toUpperCase()}
                </Text>
                <Text style={{ fontSize: 12, color: subtextColor, marginTop: 2 }}>{timeAgo(ride.created_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {ride.price ? (
                  <Text style={{ fontSize: 13, fontWeight: '900', color: ride.status === 'completed' ? GREEN : subtextColor }}>
                    {Number(ride.price).toLocaleString()} L.L
                  </Text>
                ) : null}
                <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: rideStatusColor(ride.status) + '22' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: rideStatusColor(ride.status) }}>
                    {rideStatusLabel(ride.status)}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}

      </ScrollView>

      {/* ── Edit Profile Modal ── */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: '#00000066' }} onPress={() => setEditVisible(false)} />
          <View style={[ds.modalSheet, { backgroundColor: cardBg }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: textColor }}>Edit Driver Profile</Text>
              <Pressable onPress={() => setEditVisible(false)} hitSlop={12}>
                <Text style={{ color: subtextColor, fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: 13, fontWeight: '700', color: subtextColor, marginBottom: 6 }}>Full Name</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Enter full name..."
              placeholderTextColor={subtextColor}
              style={[ds.modalInput, { backgroundColor: bg, borderColor, color: textColor }]}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveProfile}
            />

            <Pressable
              onPress={saveProfile}
              disabled={saving}
              style={[ds.btn, { backgroundColor: GOLD, marginTop: 20, opacity: saving ? 0.6 : 1 }]}
            >
              {saving
                ? <ActivityIndicator color="#000" />
                : <Text style={[ds.btnText, { color: '#000' }]}>Save Changes</Text>
              }
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ds = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1 },
  headerTitle:  { flex: 1, fontSize: 17, fontWeight: '900', marginHorizontal: 12 },
  actionChip:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  profileCard:  { borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  profilePhoto: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E5E7EB', marginBottom: 12 },
  profileName:  { fontSize: 22, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  infoGrid:     { paddingTop: 16, gap: 0 },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  infoLabel:    { fontSize: 13, fontWeight: '600' },
  infoValue:    { fontSize: 13, fontWeight: '800' },
  card:         { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 10, letterSpacing: 0.2 },
  statsGrid:    { flexDirection: 'row', alignItems: 'stretch' },
  actionRow:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  btn:          { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 3 },
  btnText:      { color: '#fff', fontWeight: '900', fontSize: 14 },
  vehiclePhoto: { width: '100%', height: 200 },
  docPhoto:     { width: '100%', height: 110, borderRadius: 12 },
  rideRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  modalSheet:   { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalInput:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '600' },
});
