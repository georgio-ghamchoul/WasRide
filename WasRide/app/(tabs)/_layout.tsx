import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { useAppState } from "@/lib/app-state";
import { supabase } from "@/lib/supabase";
import { syncPushTokenToProfile } from "@/lib/notifications";
import NotificationBell from "@/components/NotificationBell";

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#373737" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
];

function getVehicleIcon(vehicleType?: string): string {
  const v = (vehicleType ?? '').toLowerCase();
  if (v.includes('tuktuk') || v.includes('tuk')) return '🛺';
  if (v.includes('car')) return '🚗';
  return '🏍';
}

export default function HomeScreen() {
  const router = useRouter();
  const { locale, setLocale, darkMode, setDarkMode } = useAppState();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<"ride" | "delivery">("ride");
  const [step, setStep] = useState<"pickup" | "destination">("pickup");
  const [pickup, setPickup] = useState<any>(null);
  // Map center is read only at confirm time — keep it in a ref so dragging the
  // map does NOT re-render the whole screen (incl. MapView + markers) every frame.
  const centerCoordRef = useRef<any>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [onlineDrivers, setOnlineDrivers] = useState<any[]>([]);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  // Check admin from session — runs on mount and on login
  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) void syncPushTokenToProfile(session.user.id);
      const phone = (session?.user?.phone ?? '').replace(/\D/g, '');
      if (phone.endsWith('71073230')) { setShowAdminMenu(true); return; }
      if (session?.user?.id) {
        const { data } = await supabase.from('users').select('role').eq('id', session.user.id).maybeSingle();
        if (data?.role === 'admin') setShowAdminMenu(true);
      }
    }
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setShowAdminMenu(false); return; }
      if (session.user?.id) void syncPushTokenToProfile(session.user.id);
      const phone = (session.user?.phone ?? '').replace(/\D/g, '');
      if (phone.endsWith('71073230')) { setShowAdminMenu(true); return; }
      supabase.from('users').select('role').eq('id', session.user.id).maybeSingle()
        .then(({ data }) => { if (data?.role === 'admin') setShowAdminMenu(true); }, () => {});
    });
    return () => subscription.unsubscribe();
  }, []);
  const pinScale = useRef(new Animated.Value(1)).current;

  const ar = locale === 'ar';
  const bg = darkMode ? "#111827" : "#fff";
  const textColor = darkMode ? "#fff" : "#111827";
  const subtextColor = darkMode ? "#9CA3AF" : "#6B7280";
  const cardBg = darkMode ? "#1F2937" : "#F3F4F6";
  const itemBg = darkMode ? "#374151" : "#F9FAFB";
  const borderColor = darkMode ? "#374151" : "#E5E7EB";

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { setLoading(false); return; }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation(loc.coords);
        centerCoordRef.current = loc.coords;
        mapRef.current?.animateToRegion({
          latitude: loc.coords.latitude, longitude: loc.coords.longitude,
          latitudeDelta: 0.01, longitudeDelta: 0.01,
        }, 500);
      } catch (e) {
        console.log('Location error:', e);
        // Fall back to Lebanon center coords if GPS fails
        setLocation({ latitude: 33.8938, longitude: 35.5018 });
        centerCoordRef.current = { latitude: 33.8938, longitude: 35.5018 };
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    async function fetchDrivers() {
      // Only show drivers who are online AND updated presence in the last 5 minutes.
      // This clears stale markers if a driver's app crashes without setting is_online=false.
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: presence } = await supabase
        .from('driver_presence')
        .select('driver_id, latitude, longitude, updated_at')
        .eq('is_online', true)
        .gte('updated_at', staleThreshold);

      if (!presence?.length) { setOnlineDrivers([]); return; }

      const ids = presence.map(p => p.driver_id);
      const { data: driverInfo } = await supabase
        .from('public_profiles')
        .select('id, vehicle_type')
        .in('id', ids);

      const merged = presence.map(p => ({
        ...p,
        vehicle_type: driverInfo?.find(d => d.id === p.driver_id)?.vehicle_type ?? 'moto',
      }));
      setOnlineDrivers(merged);
    }
    fetchDrivers();
    // 10s is plenty for a marker refresh; 4s was two Supabase round-trips every
    // few seconds, churning markers and competing with map interaction.
    const interval = setInterval(fetchDrivers, 10000);
    return () => clearInterval(interval);
  }, []);

  function handleRegionChange(region: any) {
    // Ref write only — no re-render while the user drags.
    centerCoordRef.current = { latitude: region.latitude, longitude: region.longitude };
    if (!isMoving) {
      setIsMoving(true);
      Animated.spring(pinScale, { toValue: 0.7, useNativeDriver: true }).start();
    }
  }

  function handleRegionChangeComplete(region: any) {
    centerCoordRef.current = { latitude: region.latitude, longitude: region.longitude };
    setIsMoving(false);
    Animated.spring(pinScale, { toValue: 1, useNativeDriver: true }).start();
  }

  function confirmPoint() {
    const center = centerCoordRef.current;
    if (step === "pickup") {
      setPickup(center);
      setStep("destination");
    } else if (selectedCategory === "delivery") {
      router.push({
        pathname: "/delivery-details" as never,
        params: {
          pickupLat: pickup?.latitude, pickupLng: pickup?.longitude,
          destLat: center?.latitude, destLng: center?.longitude,
        },
      });
    } else {
      router.push({
        pathname: "/confirm-ride" as never,
        params: {
          pickupLat: pickup?.latitude, pickupLng: pickup?.longitude,
          destLat: center?.latitude, destLng: center?.longitude,
        },
      });
    }
  }

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color="#F4B400" />
        <Text style={{ marginTop: 10, color: subtextColor, fontSize: 15 }}>
          {ar ? '📍 جارٍ تحديد موقعك...' : '📍 Getting your location...'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        customMapStyle={darkMode ? darkMapStyle : undefined}
        initialRegion={{
          latitude: location?.latitude ?? 34.4667,
          longitude: location?.longitude ?? 36.2833,
          latitudeDelta: 0.01, longitudeDelta: 0.01,
        }}
        showsUserLocation
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {onlineDrivers.map(d => d.latitude && d.longitude ? (
          <Marker
            key={d.driver_id}
            coordinate={{ latitude: d.latitude, longitude: d.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.driverMarker}>
              <Text style={{ fontSize: 18 }}>{getVehicleIcon(d.vehicle_type)}</Text>
            </View>
          </Marker>
        ) : null)}
      </MapView>

      {/* TOP LEFT MENU BUTTON */}
      <View style={styles.topLeft}>
        <Pressable onPress={() => setShowMenu(true)}>
          <View style={[styles.menuBtn, { backgroundColor: darkMode ? "#1F2937" : "#fff" }]}>
            <Text style={[styles.menuDot, { color: textColor }]}>•••</Text>
          </View>
        </Pressable>
      </View>

      {/* TOP RIGHT NOTIFICATION BELL */}
      <View style={styles.topRight}>
        <View style={[styles.menuBtn, { backgroundColor: darkMode ? "#1F2937" : "#fff" }]}>
          <NotificationBell color={textColor} />
        </View>
      </View>

      {/* ANIMATED PIN */}
      <Animated.View
        style={[styles.pinContainer, { transform: [{ scale: pinScale }, { translateY: isMoving ? -10 : 0 }] }]}
        pointerEvents="none"
      >
        <View style={[styles.pinHead, { backgroundColor: step === "pickup" ? "#F4B400" : "#16A34A" }]}>
          <View style={styles.pinHeadInner} />
        </View>
        <View style={[styles.pinTail, { borderTopColor: step === "pickup" ? "#F4B400" : "#16A34A" }]} />
        <View style={[styles.pinShadow, { opacity: isMoving ? 0.2 : 0.5 }]} />
      </Animated.View>

      {/* STEP INDICATOR */}
      <View style={[styles.stepIndicator, { backgroundColor: darkMode ? "#1F2937" : "#111827" }]}>
        <Text style={styles.stepText}>
          {step === "pickup"
            ? (ar ? '📍 حرك الخريطة لتحديد نقطة الاستلام' : '📍 Move map to set pickup')
            : (ar ? '🏁 حرك الخريطة لتحديد الوجهة' : '🏁 Move map to set destination')}
        </Text>
      </View>

      {/* BOTTOM CARD */}
      <View style={[styles.bottomCard, { backgroundColor: bg }]}>

        {/* Category: Ride / Delivery */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
          <Pressable onPress={() => setSelectedCategory("ride")} style={{ flex: 1 }}>
            <View style={{
              borderRadius: 16, paddingVertical: 11, alignItems: "center",
              backgroundColor: selectedCategory === "ride" ? "#F4B400" : cardBg,
              borderWidth: 1, borderColor: selectedCategory === "ride" ? "#F4B400" : borderColor,
            }}>
              <Text style={{ fontSize: 20 }}>🚖</Text>
              <Text style={{ color: selectedCategory === "ride" ? "#111827" : textColor, fontWeight: "800", fontSize: 13, marginTop: 3 }}>
                {ar ? 'توصيل أشخاص' : 'Ride'}
              </Text>
            </View>
          </Pressable>

          <Pressable onPress={() => setSelectedCategory("delivery")} style={{ flex: 1 }}>
            <View style={{
              borderRadius: 16, paddingVertical: 11, alignItems: "center",
              backgroundColor: selectedCategory === "delivery" ? "#16A34A" : cardBg,
              borderWidth: 1, borderColor: selectedCategory === "delivery" ? "#16A34A" : borderColor,
            }}>
              <Text style={{ fontSize: 20 }}>📦</Text>
              <Text style={{ color: selectedCategory === "delivery" ? "#fff" : textColor, fontWeight: "800", fontSize: 13, marginTop: 3 }}>
                {ar ? 'توصيل طلبات' : 'Delivery'}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Pickup confirmed */}
        {pickup ? (
          <View style={[styles.summaryRow, { backgroundColor: cardBg, borderRadius: 12, padding: 10, marginBottom: 8 }]}>
            <View style={[styles.dot, { backgroundColor: "#F4B400" }]} />
            <Text style={[styles.summaryText, { color: textColor }]}>
              {ar ? '✓ تم تحديد نقطة الاستلام' : '✓ Pickup confirmed'}
            </Text>
            <Pressable onPress={() => { setStep("pickup"); setPickup(null); }}>
              <Text style={{ color: "#F4B400", fontWeight: "800", fontSize: 13 }}>
                {ar ? 'تغيير' : 'Change'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Confirm button */}
        <Pressable onPress={confirmPoint} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
          <View style={{
            borderRadius: 18,
            backgroundColor: step === "pickup" ? "#F4B400" : "#16A34A",
            padding: 18, alignItems: "center", marginTop: 4,
          }}>
            <Text style={{ color: step === "pickup" ? "#111827" : "#fff", fontSize: 17, fontWeight: "900" }}>
              {step === "pickup"
                ? (ar ? '📍 تأكيد نقطة الاستلام' : '📍 Confirm Pickup')
                : (ar ? '🏁 تأكيد الوجهة' : '🏁 Confirm Destination')}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* MENU MODAL */}
      <Modal visible={showMenu} transparent animationType="fade">
        <Pressable style={styles.menuOverlay} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuCard, { backgroundColor: darkMode ? "#1F2937" : "#fff" }]}>

            {/* ── ACCOUNT ── */}
            <Text style={[styles.sectionLabel, { color: subtextColor }]}>
              {ar ? 'الحساب' : 'ACCOUNT'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setShowMenu(false); router.push('/profile' as never); }}>
              <Text style={styles.menuItemIcon}>👤</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>{ar ? 'الملف الشخصي' : 'My Profile'}</Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>

            {/* ── ADMIN PANEL — only for admin ── */}
            {showAdminMenu && (
              <>
                <Text style={[styles.sectionLabel, { color: '#F4B400', marginTop: 14 }]}>
                  {ar ? 'لوحة الإدارة' : 'ADMIN PANEL'}
                </Text>
                <Pressable
                  style={[styles.menuItem, { backgroundColor: darkMode ? '#2D3748' : '#FFFBEB' }]}
                  onPress={() => { setShowMenu(false); router.push('/admin' as never); }}
                >
                  <Text style={styles.menuItemIcon}>🛡️</Text>
                  <Text style={[styles.menuItemText, { color: '#F4B400', fontWeight: '800' }]}>
                    {ar ? 'لوحة التحكم' : 'Admin Dashboard'}
                  </Text>
                  <Text style={[styles.menuArrow, { color: '#F4B400' }]}>›</Text>
                </Pressable>
              </>
            )}

            {/* ── SETTINGS ── */}
            <Text style={[styles.sectionLabel, { color: subtextColor, marginTop: 14 }]}>
              {ar ? 'الإعدادات' : 'SETTINGS'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setLocale(locale === 'en' ? 'ar' : 'en'); setShowMenu(false); }}>
              <Text style={styles.menuItemIcon}>🌐</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>
                {ar ? '🇬🇧 English' : '🇱🇧 العربية'}
              </Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>
            <View style={{ height: 6 }} />
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setDarkMode(!darkMode); setShowMenu(false); }}>
              <Text style={styles.menuItemIcon}>{darkMode ? '☀' : '🌙'}</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>
                {darkMode ? (ar ? 'الوضع الفاتح' : 'Light Mode') : (ar ? 'الوضع الداكن' : 'Dark Mode')}
              </Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>

            {/* ── HISTORY ── */}
            <Text style={[styles.sectionLabel, { color: subtextColor, marginTop: 14 }]}>
              {ar ? 'النشاط' : 'ACTIVITY'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setShowMenu(false); router.push('/ride-history' as never); }}>
              <Text style={styles.menuItemIcon}>🕒</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>{ar ? 'سجل الرحلات' : 'Ride History'}</Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>

            {/* ── SUPPORT ── */}
            <Text style={[styles.sectionLabel, { color: subtextColor, marginTop: 14 }]}>
              {ar ? 'المساعدة' : 'SUPPORT'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setShowMenu(false); router.push('/support' as never); }}>
              <Text style={styles.menuItemIcon}>🎧</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>{ar ? 'خدمة العملاء' : 'Customer Support'}</Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>

            {/* ── DANGER ── */}
            <Text style={[styles.sectionLabel, { color: '#EF4444', marginTop: 14 }]}>
              {ar ? 'خطر' : 'DANGER'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: '#FEF2F2' }]}
              onPress={async () => {
                setShowMenu(false);
                await supabase.auth.signOut();
                router.replace('/login' as never);
              }}>
              <Text style={styles.menuItemIcon}>🚪</Text>
              <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{ar ? 'تسجيل الخروج' : 'Sign Out'}</Text>
              <Text style={[styles.menuArrow, { color: '#EF4444' }]}>›</Text>
            </Pressable>

          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  driverMarker: { backgroundColor: '#fff', borderRadius: 20, padding: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 4 },
  topLeft: { position: "absolute", top: 60, left: 16, zIndex: 10 },
  topRight: { position: "absolute", top: 60, right: 16, zIndex: 10 },
  menuBtn: {
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  menuDot: { fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  menuOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start", paddingTop: 110, paddingLeft: 16,
  },
  menuCard: {
    borderRadius: 20, padding: 14, width: 240,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 10,
  },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 6, paddingHorizontal: 4 },
  menuItem: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 13, gap: 10 },
  menuItemIcon: { fontSize: 17 },
  menuItemText: { flex: 1, fontSize: 15, fontWeight: "700" },
  menuArrow: { fontSize: 18, fontWeight: "600" },
  pinContainer: {
    position: "absolute", top: "50%", left: "50%",
    marginLeft: -18, marginTop: -52, alignItems: "center",
  },
  pinHead: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  pinHeadInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff" },
  pinTail: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8,
    borderTopWidth: 12, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -2,
  },
  pinShadow: { width: 12, height: 6, borderRadius: 6, backgroundColor: "#000", marginTop: 4 },
  stepIndicator: {
    position: "absolute", top: 60, alignSelf: "center",
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  stepText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  bottomCard: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 36,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 10,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  summaryText: { flex: 1, fontSize: 13, fontWeight: "600" },
});
