import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

export default function PublicDriverProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';
  const dark = darkMode;

  const [driver, setDriver] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [totalTrips, setTotalTrips] = useState(0);
  const [heroImageError, setHeroImageError] = useState(false);

  const bg = dark ? '#0F172A' : '#F8FAFC';
  const cardBg = dark ? '#1E293B' : '#fff';
  const cardBorder = dark ? '#334155' : '#E5E7EB';
  const textPrimary = dark ? '#F1F5F9' : '#111827';
  const textSecondary = dark ? '#94A3B8' : '#6B7280';
  const textMuted = dark ? '#64748B' : '#9CA3AF';

  useEffect(() => { loadDriver(); }, [id]);

  async function loadDriver() {
    setLoading(true);
    try {
      // Public driver browsing — read from the safe view (no phone/license exposed).
      const { data, error } = await supabase
        .from('public_profiles')
        .select('*')
        .eq('id', id as string)
        .maybeSingle();

      if (error) console.log('Profile fetch error:', error);

      if (data) {
        // Attach photo URL — drivers use driver-images bucket, riders use profile-images
        const isDriver = data.role === 'driver';
        const bucket  = isDriver ? 'driver-images' : 'profile-images';
        const path    = isDriver ? `drivers/${id}.jpg` : `riders/${id}.jpg`;
        const photoUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

        // Online status from driver_presence (riders won't have a row — defaults to false)
        const { data: presence } = await supabase
          .from('driver_presence')
          .select('is_online')
          .eq('driver_id', id as string)
          .maybeSingle();

        setDriver({
          ...data,
          rating: data.average_rating ?? 5,
          driver_image: photoUrl,
          is_online: presence?.is_online ?? false,
        });
        setTotalTrips(data.trips_completed ?? 0);
      }
    } catch (e) {
      console.log('Load driver error:', e);
    } finally {
      setLoading(false);
    }
  }

  function renderStars(rating: number) {
    return Array.from({ length: 5 }, (_, i) => (
      <Text key={i} style={{ fontSize: 18, color: i < Math.round(rating) ? '#F4B400' : (dark ? '#334155' : '#E5E7EB') }}>
        ★
      </Text>
    ));
  }

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color="#F4B400" />
      </View>
    );
  }

  if (!driver) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: bg }]}>
        <Text style={{ color: textSecondary, fontSize: 16 }}>
          {ar ? 'السائق غير موجود' : 'Driver not found'}
        </Text>
      </View>
    );
  }

  const isDriver = driver.role === 'driver';
  const vehicleLabel = driver.vehicle_type === 'Motorcycle'
    ? (ar ? 'دراجة نارية' : 'Motorcycle')
    : driver.vehicle_type === 'Tuktuk'
    ? (ar ? 'تكتك' : 'Tuktuk')
    : driver.vehicle_type === 'Car'
    ? (ar ? 'سيارة' : 'Car')
    : driver.vehicle_type || '';
  const vehicleIcon = driver.vehicle_type === 'Tuktuk' ? '🛺' : driver.vehicle_type === 'Car' ? '🚗' : '🏍';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

      {/* BACK BUTTON */}
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Text style={[styles.backText, { color: '#fff' }]}>‹</Text>
      </Pressable>

      {/* HERO PHOTO */}
      <View style={styles.heroSection}>
        {driver.driver_image && !heroImageError ? (
          <Image source={{ uri: driver.driver_image }} style={styles.driverPhoto} onError={() => setHeroImageError(true)} />
        ) : (
          <View style={[styles.driverPhotoPlaceholder, { backgroundColor: dark ? '#1E293B' : '#F3F4F6', borderColor: cardBorder }]}>
            <Text style={{ fontSize: 64 }}>{isDriver ? '🏍' : '👤'}</Text>
          </View>
        )}

        {/* Online badge — only for drivers */}
        {isDriver && (
          <View style={[styles.statusBadge, { backgroundColor: driver.is_online ? '#16A34A' : '#6B7280' }]}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {driver.is_online ? (ar ? 'متاح' : 'Available') : (ar ? 'مشغول' : 'Busy')}
            </Text>
          </View>
        )}
      </View>

      {/* NAME + STARS */}
      <View style={styles.nameSection}>
        <Text style={[styles.driverName, { color: textPrimary }]}>{driver.full_name || (ar ? 'مجهول' : 'Unknown')}</Text>
        <View style={styles.starsRow}>
          {renderStars(driver.rating || 5)}
          <Text style={[styles.ratingNumber, { color: textSecondary }]}>{(driver.rating || 5).toFixed(1)}</Text>
        </View>
      </View>

      {/* STATS ROW */}
      <View style={[styles.statsRow, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: textPrimary }]}>{(driver.rating || 5).toFixed(1)}</Text>
          <Text style={[styles.statLabel, { color: textSecondary }]}>{ar ? 'التقييم' : 'Rating'}</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: textPrimary }]}>{totalTrips}</Text>
          <Text style={[styles.statLabel, { color: textSecondary }]}>{ar ? 'الرحلات' : 'Trips'}</Text>
        </View>
        {isDriver && (
          <>
            <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: textPrimary }]}>{vehicleIcon}</Text>
              <Text style={[styles.statLabel, { color: textSecondary }]}>{ar ? 'المركبة' : 'Vehicle'}</Text>
            </View>
          </>
        )}
      </View>

      {/* VEHICLE CARD — drivers only */}
      {isDriver && (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <Text style={[styles.cardTitle, { color: textPrimary }]}>
            {vehicleIcon} {ar ? 'معلومات المركبة' : 'Vehicle Info'}
          </Text>
          {!!vehicleLabel && <Text style={[styles.vehicleType, { color: textSecondary }]}>{vehicleLabel}</Text>}
          {driver.vehicle_image ? (
            <Image source={{ uri: driver.vehicle_image }} style={[styles.vehiclePhoto, { borderColor: cardBorder }]} resizeMode="cover" />
          ) : (
            <View style={[styles.vehiclePhotoPlaceholder, { backgroundColor: dark ? '#0F172A' : '#F9FAFB', borderColor: cardBorder }]}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>{vehicleIcon}</Text>
              <Text style={{ color: textMuted, fontSize: 13 }}>{ar ? 'لا توجد صورة للمركبة' : 'No vehicle photo'}</Text>
            </View>
          )}
        </View>
      )}

      {/* ABOUT CARD */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Text style={[styles.cardTitle, { color: textPrimary }]}>
          {isDriver ? (ar ? '⭐ عن السائق' : '⭐ About Driver') : (ar ? '⭐ عن الراكب' : '⭐ About Rider')}
        </Text>

        {/* Vehicle type row — drivers only */}
        {isDriver && !!vehicleLabel && (
          <>
            <View style={styles.aboutRow}>
              <Text style={[styles.aboutLabel, { color: textSecondary }]}>{ar ? 'نوع المركبة' : 'Vehicle type'}</Text>
              <Text style={[styles.aboutValue, { color: textPrimary }]}>{vehicleLabel}</Text>
            </View>
            <View style={[styles.separator, { backgroundColor: cardBorder }]} />
          </>
        )}

        <View style={styles.aboutRow}>
          <Text style={[styles.aboutLabel, { color: textSecondary }]}>{ar ? 'الرحلات المكتملة' : 'Completed trips'}</Text>
          <Text style={[styles.aboutValue, { color: textPrimary }]}>{totalTrips}</Text>
        </View>
        <View style={[styles.separator, { backgroundColor: cardBorder }]} />
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutLabel, { color: textSecondary }]}>{ar ? 'التقييم' : 'Rating'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#F4B400', fontSize: 14 }}>★</Text>
            <Text style={[styles.aboutValue, { color: textPrimary }]}>{(driver.rating || 5).toFixed(1)} / 5</Text>
          </View>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingBottom: 48 },
  backBtn: {
    position: 'absolute', top: 52, left: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  backText: { fontSize: 26, fontWeight: '300', color: '#fff', lineHeight: 30 },
  heroSection: { position: 'relative', alignItems: 'center', marginBottom: 0 },
  driverPhoto: {
    width: '100%', height: 320,
  },
  driverPhotoPlaceholder: {
    width: '100%', height: 320, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1,
  },
  statusBadge: {
    position: 'absolute', bottom: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  statusText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  nameSection: { alignItems: 'center', paddingTop: 20, paddingBottom: 16, paddingHorizontal: 24 },
  driverName: { fontSize: 28, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingNumber: { fontSize: 16, fontWeight: '700', marginLeft: 6 },
  statsRow: {
    flexDirection: 'row', marginHorizontal: 20, borderRadius: 18,
    borderWidth: 1, padding: 16, marginBottom: 16,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statDivider: { width: 1, marginHorizontal: 8 },
  card: {
    marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 16, overflow: 'hidden',
  },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 10 },
  vehicleType: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
  vehiclePhoto: {
    width: '100%', height: 200, borderRadius: 12, borderWidth: 1,
  },
  vehiclePhotoPlaceholder: {
    width: '100%', height: 160, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  aboutRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10,
  },
  aboutLabel: { fontSize: 14, fontWeight: '600' },
  aboutValue: { fontSize: 14, fontWeight: '800' },
  separator: { height: 1 },
});
