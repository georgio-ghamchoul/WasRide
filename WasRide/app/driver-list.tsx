import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { getCancelState } from "@/lib/cancel-limits";
import { useAppState } from "@/lib/app-state";

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function DriverListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';
  const dark = darkMode;

  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [radius, setRadius] = useState(3);
  const [searchStep, setSearchStep] = useState(0); // 0=3km, 1=5km, 2=8km, 3=10km
  const [requesting, setRequesting] = useState<string | null>(null);

  const pickupLat = parseFloat(params.pickupLat as string) || 33.8938;
  const pickupLng = parseFloat(params.pickupLng as string) || 35.5018;

  // Search steps with delays: 3km → wait 4s → 5km → wait 4s → 8km → wait 4s → 10km
  const RADIUS_STEPS = [3, 5, 8, 10];
  const STEP_DELAY = 4000; // 4 seconds between each expansion

  useEffect(() => { startSearch(); }, []);

  async function fetchNearbyDrivers(km: number) {
    const { data: presence } = await supabase
      .from('driver_presence')
      .select('driver_id, latitude, longitude')
      .eq('is_online', true);

    if (!presence?.length) return [];

    const ids = presence.map(d => d.driver_id);
    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, full_name, vehicle_type')
      .in('id', ids);

    return presence
      .map(d => {
        const profile = profiles?.find(p => p.id === d.driver_id);
        const distance = getDistanceKm(pickupLat, pickupLng, d.latitude ?? 0, d.longitude ?? 0);
        const photoUrl = supabase.storage.from('driver-images').getPublicUrl(`drivers/${d.driver_id}.jpg`).data.publicUrl;
        return {
          id: d.driver_id,
          latitude: d.latitude,
          longitude: d.longitude,
          full_name: profile?.full_name || '',
          vehicle_type: profile?.vehicle_type || '',
          driver_image: photoUrl,
          distance,
        };
      })
      .filter(d => d.distance <= km)
      .sort((a, b) => a.distance - b.distance);
  }

  async function startSearch() {
    setLoading(true);
    for (let i = 0; i < RADIUS_STEPS.length; i++) {
      const km = RADIUS_STEPS[i];
      setRadius(km);
      setSearchStep(i);

      const nearby = await fetchNearbyDrivers(km);
      if (nearby.length > 0) {
        setDrivers(nearby);
        setLoading(false);
        return;
      }

      if (i < RADIUS_STEPS.length - 1) await sleep(STEP_DELAY);
    }

    setDrivers([]);
    setLoading(false);
  }

  async function findDrivers(km: number) {
    setLoading(true);
    setRadius(km);
    const nearby = await fetchNearbyDrivers(km);
    setDrivers(nearby);
    setLoading(false);
  }

  async function requestDriver(driver: any) {
    setRequesting(driver.id);
    const { data: { user } } = await supabase.auth.getUser();

    // Cancel-limit lockout: blocked riders can't request a new ride.
    if (user) {
      try {
        const cs = await getCancelState(user.id);
        if (cs.locked) {
          const mins = Math.ceil(cs.remainingMs / 60000);
          Alert.alert(
            ar ? 'محظور مؤقتًا' : 'Temporarily blocked',
            ar
              ? `لقد ألغيت عدة رحلات. حاول مرة أخرى بعد ${mins} دقيقة.`
              : `You cancelled too many rides. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
          );
          setRequesting(null);
          return;
        }
      } catch (e) { console.log('getCancelState error:', e); }
    }

    if (user) {
      await supabase.from('profiles').upsert({
        id: user.id,
        phone: user.phone || '',
        role: 'rider',
      }, { onConflict: 'id', ignoreDuplicates: true });
    }
    const { data: ride, error } = await supabase.from('rides').insert({
      passenger_id: user?.id, driver_id: driver.id,
      pickup_lat: pickupLat, pickup_lng: pickupLng,
      dropoff_lat: parseFloat(params.destLat as string),
      dropoff_lng: parseFloat(params.destLng as string),
      price: parseInt(params.price as string) || 100000,
      note: params.note as string || '',
      service: params.service as string || 'moto',
      status: 'searching',
    }).select().single();

    if (error || !ride) {
      console.log('❌ Ride insert error:', JSON.stringify(error));
      Alert.alert(ar ? 'خطأ' : 'Error', error?.message || 'Could not create ride request');
      setRequesting(null);
      return;
    }
    const { error: reqError } = await supabase.from('ride_requests').insert({ ride_id: ride.id, driver_id: driver.id, status: 'pending' });
    if (reqError) {
      console.log('❌ Ride request insert error:', JSON.stringify(reqError));
      Alert.alert(ar ? 'خطأ' : 'Error', reqError?.message || 'Could not send request to driver');
      setRequesting(null);
      return;
    }
    router.push({ pathname: '/waiting', params: { rideId: ride.id, driverId: driver.id } } as never);
    setRequesting(null);
  }

  // Theme colors
  const bg = dark ? '#0F172A' : '#F9FAFB';
  const cardBg = dark ? '#1E293B' : '#fff';
  const cardBorder = dark ? '#334155' : '#E5E7EB';
  const textPrimary = dark ? '#F1F5F9' : '#111827';
  const textSecondary = dark ? '#94A3B8' : '#6B7280';
  const textMuted = dark ? '#64748B' : '#9CA3AF';

  const searchMessages = ar
    ? [`جاري البحث في نطاق ${radius} كم...`, `جاري توسيع البحث إلى ${radius} كم...`]
    : [`Searching within ${radius} km...`, `Expanding search to ${radius} km...`];

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: bg }]}>
        {/* Animated search indicator */}
        <View style={[styles.searchCircle, { borderColor: dark ? '#F4B400' : '#111827' }]}>
          <ActivityIndicator size="large" color="#F4B400" />
        </View>
        <Text style={[styles.loadingTitle, { color: textPrimary }]}>
          {ar ? 'جاري البحث عن سائق' : 'Searching for a driver'}
        </Text>
        <Text style={[styles.loadingText, { color: textSecondary }]}>
          {ar
            ? `نطاق البحث: ${radius} كم`
            : `نطاق البحث: ${radius} كم`}
        </Text>

        {/* Radius steps indicator */}
        <View style={styles.stepsRow}>
          {RADIUS_STEPS.map((km, i) => (
            <View key={km} style={styles.stepItem}>
              <View style={[
                styles.stepDot,
                {
                  backgroundColor: i < searchStep
                    ? '#16A34A'
                    : i === searchStep
                      ? '#F4B400'
                      : (dark ? '#334155' : '#E5E7EB'),
                  borderColor: i === searchStep ? '#F4B400' : 'transparent',
                  borderWidth: i === searchStep ? 2 : 0,
                }
              ]} />
              <Text style={[styles.stepLabel, { color: i <= searchStep ? '#F4B400' : textMuted }]}>
                {km} كم
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.loadingHint, { color: textMuted }]}>
          {ar ? 'سنوسّع نطاق البحث تلقائياً إذا لم يُعثر على سائقين' : 'We\'ll expand the search automatically if needed'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Text style={[styles.title, { color: textPrimary }]}>
        {ar ? '🏍 السائقون المتاحون' : '🏍 Available Drivers'}
      </Text>
      <Text style={[styles.subtitle, { color: textSecondary }]}>
        {ar
          ? `تم العثور على ${drivers.length} سائق في نطاق ${radius} كم`
          : `${drivers.length} سائق في نطاق ${radius} كم`}
      </Text>

      {drivers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>😔</Text>
          <Text style={[styles.emptyTitle, { color: textPrimary }]}>
            {ar ? 'لا يوجد سائقون متاحون' : 'No drivers available'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: textSecondary }]}>
            {ar ? 'لا يوجد سائقون في نطاق 10 كم' : 'No drivers found within 10 km'}
          </Text>
          <Pressable onPress={() => startSearch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>{ar ? 'حاول مجدداً' : 'Try Again'}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={drivers}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/driver-profile/[id]', params: { id: item.id } } as never)}
              style={[styles.driverCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
              {/* Driver Photo or Initials */}
              <View style={styles.driverLeft}>
                {item.driver_image ? (
                  <Image source={{ uri: item.driver_image }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.full_name?.[0]?.toUpperCase() || '?'}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.driverName, { color: textPrimary }]}>{item.full_name}</Text>
                  <Text style={[styles.driverDetails, { color: textSecondary }]}>
                    📍 {item.distance.toFixed(1)} {ar ? 'كم' : 'km'} · ⭐ {item.rating?.toFixed(1) || '5.0'}
                  </Text>
                  <Text style={[styles.driverVehicle, { color: textMuted }]}>
                    {item.vehicle_type === 'Tuktuk' ? '🛺' : item.vehicle_type === 'Car' ? '🚗' : '🏍'} {item.vehicle_type}
                  </Text>
                  <Text style={[styles.viewProfile, { color: dark ? '#F4B400' : '#6B7280' }]}>
                    {ar ? 'عرض الملف ←' : 'View profile →'}
                  </Text>
                </View>
              </View>

              {/* Right side: vehicle photo thumbnail + request button */}
              <View style={styles.driverRight}>
                {item.vehicle_image ? (
                  <Image source={{ uri: item.vehicle_image }} style={[styles.vehicleThumb, { borderColor: cardBorder }]} />
                ) : null}
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); requestDriver(item); }}
                  disabled={requesting === item.id}
                >
                  <View style={[
                    styles.requestBtn,
                    { backgroundColor: dark ? '#F4B400' : '#111827' },
                    requesting === item.id && { backgroundColor: dark ? '#334155' : '#D1D5DB' }
                  ]}>
                    {requesting === item.id
                      ? <ActivityIndicator color={dark ? '#111827' : '#fff'} size="small" />
                      : <Text style={[styles.requestBtnText, { color: dark ? '#111827' : '#fff' }]}>
                          {ar ? 'طلب' : 'Request'}
                        </Text>}
                  </View>
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1, alignItems: "center", justifyContent: "center", padding: 32,
  },
  searchCircle: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  loadingTitle: {
    fontSize: 22, fontWeight: "900", marginBottom: 8, textAlign: 'center',
  },
  loadingText: {
    fontSize: 15, fontWeight: "600", textAlign: 'center', marginBottom: 28,
  },
  stepsRow: {
    flexDirection: 'row', gap: 20, marginBottom: 24, alignItems: 'center',
  },
  stepItem: { alignItems: 'center', gap: 6 },
  stepDot: { width: 16, height: 16, borderRadius: 8 },
  stepLabel: { fontSize: 11, fontWeight: '700' },
  loadingHint: { fontSize: 12, textAlign: 'center', maxWidth: 260 },
  container: { flex: 1, padding: 20, paddingTop: 60 },
  title: { fontSize: 26, fontWeight: "900", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyEmoji: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, marginBottom: 24 },
  retryBtn: { backgroundColor: "#F4B400", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontSize: 15, fontWeight: "800", color: "#111827" },
  driverCard: {
    borderRadius: 18, padding: 14, marginBottom: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1,
  },
  driverLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  driverRight: { alignItems: "center", gap: 8, marginLeft: 8 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: "#F4B400",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  avatarImg: {
    width: 56, height: 56, borderRadius: 28, flexShrink: 0,
  },
  avatarText: { fontSize: 22, fontWeight: "900", color: "#111827" },
  vehicleThumb: {
    width: 64, height: 44, borderRadius: 8, borderWidth: 1,
  },
  driverName: { fontSize: 15, fontWeight: "800", marginBottom: 2 },
  driverDetails: { fontSize: 12, marginBottom: 2 },
  driverVehicle: { fontSize: 12, marginBottom: 2 },
  viewProfile: { fontSize: 11, fontWeight: '700' },
  requestBtn: {
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, minWidth: 74, alignItems: "center",
  },
  requestBtnText: { fontWeight: "800", fontSize: 13 },
});
