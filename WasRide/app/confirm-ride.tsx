import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, Alert, ScrollView } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialIcons, Feather, Ionicons } from "@expo/vector-icons";
import { useAppState } from "@/lib/app-state";
import { supabase } from "@/lib/supabase";
import { getCancelState } from "@/lib/cancel-limits";

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8EC3B0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d3561" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4a7a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1b2a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1e2a3a" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#4b6a88" }] },
];


export default function ConfirmRideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<any>(null);
  const { locale, darkMode } = useAppState();
  const ar   = locale === "ar";
  const dark = darkMode;

  const [price, setPrice]               = useState(100000);
  const [note, setNote]                 = useState("");
  // For a ride: "fastest" = First Available (matches moto or tuktuk). For a delivery:
  // the value still holds the target vehicle (Motorcycle/Tuktuk/Car) chosen by item size.
  const isDelivery = params.service === "couriers";
  const [vehicleFilter, setVehicleFilter] = useState<"fastest" | "Motorcycle" | "Tuktuk" | "Car">(
    isDelivery ? "Motorcycle" : "fastest"
  );
  const [showNote, setShowNote]         = useState(false);
  const [showPriceEdit, setShowPriceEdit] = useState(false);
  const [priceInput, setPriceInput]     = useState("");
  const [loading, setLoading]           = useState(false);
  const [routeCoords, setRouteCoords]   = useState<any[]>([]);
  const [distance, setDistance]         = useState("");
  const [duration, setDuration]         = useState("");
  const [fetchingRoute, setFetchingRoute] = useState(true);

  const pickup = {
    latitude:  parseFloat(params.pickupLat as string) || 33.8938,
    longitude: parseFloat(params.pickupLng as string) || 35.5018,
  };
  const destination = {
    latitude:  parseFloat(params.destLat as string) || 33.8938,
    longitude: parseFloat(params.destLng as string) || 35.5018,
  };
  const midpoint = {
    latitude:  (pickup.latitude  + destination.latitude)  / 2,
    longitude: (pickup.longitude + destination.longitude) / 2,
  };
  const latDelta = Math.abs(pickup.latitude  - destination.latitude)  * 2 + 0.05;
  const lngDelta = Math.abs(pickup.longitude - destination.longitude) * 2 + 0.05;

  // Theme
  const bg           = dark ? "#0F172A" : "#FFFFFF";
  const cardBg       = dark ? "#1E293B" : "#F8FAFC";
  const cardBorder   = dark ? "#334155" : "#E2E8F0";
  const textPrimary  = dark ? "#F1F5F9" : "#111827";
  const textSecondary = dark ? "#94A3B8" : "#6B7280";
  const btnBg        = dark ? "#334155" : "#F1F5F9";
  const btnBorder    = dark ? "#475569" : "#E2E8F0";

  useEffect(() => { fetchRoute(); }, []);

  async function fetchRoute() {
    try {
      setFetchingRoute(true);
      const url = `https://router.project-osrm.org/route/v1/driving/${pickup.longitude},${pickup.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route  = data.routes[0];
        const coords = (route.geometry?.coordinates || []).map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
        setRouteCoords(coords);
        setDistance(`${(route.distance / 1000).toFixed(1)} ${ar ? "كم" : "km"}`);
        setDuration(`${Math.ceil(route.duration / 60)} ${ar ? "دق" : "min"}`);
        // Price stays at the 100,000 default — rider raises it manually for longer trips.
        setTimeout(() => {
          mapRef.current?.fitToCoordinates([pickup, destination], {
            edgePadding: { top: 80, right: 80, bottom: 360, left: 80 }, animated: true,
          });
        }, 500);
      }
    } catch (e) {
      console.log("Route error:", e);
    } finally {
      setFetchingRoute(false);
    }
  }

  function formatPrice(p: number) {
    return p.toLocaleString() + (ar ? " ل.ل" : " L.L");
  }

  async function findOffer() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert(ar ? "خطأ" : "Error", ar ? "يرجى تسجيل الدخول" : "Please log in"); setLoading(false); return; }

      // Cancel-limit lockout: blocked riders can't request a new ride.
      try {
        const cs = await getCancelState(user.id);
        if (cs.locked) {
          const mins = Math.ceil(cs.remainingMs / 60000);
          Alert.alert(
            ar ? "محظور مؤقتًا" : "Temporarily blocked",
            ar
              ? `لقد ألغيت عدة رحلات. حاول مرة أخرى بعد ${mins} دقيقة.`
              : `You cancelled too many rides. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`
          );
          setLoading(false);
          return;
        }
      } catch (e) { console.log("getCancelState error:", e); }

      await supabase.from("profiles").upsert(
        { id: user.id, phone: user.phone || "", role: "rider" },
        { onConflict: "id", ignoreDuplicates: true }
      );

      // For delivery requests, pack all delivery details into the note field as JSON
      // so drivers see the right card. Normal rides keep the rider's plain text note.
      let finalNote = note;
      const deliveryType = params.deliveryType as string | undefined;
      if (deliveryType === 'store') {
        finalNote = JSON.stringify({
          _t:    'store',
          store: (params.storeName    as string) || '',
          items: (params.storeNote    as string) || '',
          phone: (params.yourPhone    as string) || '',
        });
      } else if (deliveryType === 'courier') {
        finalNote = JSON.stringify({
          _t:        'pkg',
          item:      (params.itemType       as string) || '',
          note:      (params.courierNote    as string) || '',
          sender:    (params.senderPhone    as string) || '',
          recipient: (params.recipientPhone as string) || '',
        });
      }

      const { data: ride, error } = await supabase.from("rides").insert({
        passenger_id: user.id,
        pickup_lat:   parseFloat(params.pickupLat as string),
        pickup_lng:   parseFloat(params.pickupLng as string),
        dropoff_lat:  parseFloat(params.destLat as string),
        dropoff_lng:  parseFloat(params.destLng as string),
        price, note: finalNote, status: "searching",
      }).select().single();

      if (error || !ride) {
        Alert.alert(ar ? "خطأ" : "Error", error?.message || (ar ? "فشل إنشاء الرحلة" : "Could not create ride"));
        setLoading(false);
        return;
      }
      router.push({ pathname: "/waiting", params: { rideId: ride.id, vehicleFilter } } as never);
    } catch (e: any) {
      Alert.alert(ar ? "خطأ" : "Error", e.message);
    } finally {
      setLoading(false);
    }
  }

  // Ride vehicle options. "First Available" matches the nearest moto or tuktuk.
  const rideVehicles = [
    { key: "fastest"    as const, labelEn: "First Available", labelAr: "الأسرع", subEn: "Moto / Tuktuk", subAr: "موتو / تكتك", icon: <MaterialIcons name="bolt" size={22} color={vehicleFilter === "fastest" ? "#F4B400" : textSecondary} /> },
    { key: "Motorcycle" as const, labelEn: "Moto",   labelAr: "موتو",  subEn: "1 passenger", subAr: "راكب 1",  icon: <Text style={{ fontSize: 22 }}>🏍️</Text> },
    { key: "Tuktuk"     as const, labelEn: "Tuktuk", labelAr: "تكتك",  subEn: "Up to 3",     subAr: "حتى 3",   icon: <Text style={{ fontSize: 22 }}>🛺</Text> },
    { key: "Car"        as const, labelEn: "Car",    labelAr: "سيارة", subEn: "Up to 4",     subAr: "حتى 4",   icon: <Text style={{ fontSize: 22 }}>🚗</Text> },
  ];

  // Delivery item-size options. Each maps to the vehicle that carries it.
  const deliverySizes = [
    { key: "Motorcycle" as const, labelEn: "Small",  labelAr: "صغير",   subEn: "Moto",   subAr: "موتو", icon: <Text style={{ fontSize: 22 }}>🏍️</Text> },
    { key: "Tuktuk"     as const, labelEn: "Medium", labelAr: "متوسط",  subEn: "Tuktuk", subAr: "تكتك", icon: <Text style={{ fontSize: 22 }}>🛺</Text> },
    { key: "Car"        as const, labelEn: "Large",  labelAr: "كبير",   subEn: "Car",    subAr: "سيارة", icon: <Text style={{ fontSize: 22 }}>🚗</Text> },
  ];

  const options = isDelivery ? deliverySizes : rideVehicles;

  return (
    <View style={{ flex: 1 }}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        customMapStyle={dark ? darkMapStyle : undefined}
        initialRegion={{ latitude: midpoint.latitude, longitude: midpoint.longitude, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
      >
        <Marker coordinate={pickup}>
          <View style={styles.markerA}><Text style={styles.markerLabel}>A</Text></View>
        </Marker>
        <Marker coordinate={destination}>
          <View style={styles.markerB}><Text style={styles.markerLabel}>B</Text></View>
        </Marker>
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor={dark ? "#F4B400" : "#111827"} strokeWidth={4} />
        )}
      </MapView>

      {/* Route loading pill */}
      {fetchingRoute && (
        <View style={[styles.routeLoading, { backgroundColor: dark ? "#1E293B" : "#fff" }]}>
          <ActivityIndicator color="#F4B400" size="small" />
          <Text style={{ marginLeft: 8, color: textPrimary, fontWeight: "600", fontSize: 13 }}>
            {ar ? "جاري البحث عن المسار..." : "Finding route..."}
          </Text>
        </View>
      )}

      {/* BOTTOM SHEET */}
      <View style={[styles.bottomCard, { backgroundColor: bg }]}>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>

          {/* Trip info strip */}
          {distance ? (
            <View style={[styles.tripStrip, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <View style={styles.tripItem}>
                <Feather name="map-pin" size={14} color="#F4B400" />
                <Text style={[styles.tripValue, { color: textPrimary }]}>{distance}</Text>
                <Text style={[styles.tripLabel, { color: textSecondary }]}>{ar ? "المسافة" : "Distance"}</Text>
              </View>
              <View style={[styles.tripDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.tripItem}>
                <Feather name="clock" size={14} color="#F4B400" />
                <Text style={[styles.tripValue, { color: textPrimary }]}>{duration}</Text>
                <Text style={[styles.tripLabel, { color: textSecondary }]}>{ar ? "الوقت" : "Est. time"}</Text>
              </View>
              <View style={[styles.tripDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.tripItem}>
                <Ionicons name="bicycle" size={14} color="#F4B400" />
                <Text style={[styles.tripValue, { color: textPrimary }]}>
                  {params.service === "moto" ? (ar ? "دراجة" : "Moto") : (ar ? "توصيل" : "Delivery")}
                </Text>
                <Text style={[styles.tripLabel, { color: textSecondary }]}>{ar ? "النوع" : "Type"}</Text>
              </View>
            </View>
          ) : null}

          {/* Vehicle type (ride) / item size (delivery) */}
          <View style={[styles.section, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: textSecondary }]}>
              {isDelivery ? (ar ? "حجم الشحنة" : "Item Size") : (ar ? "نوع المركبة" : "Vehicle Type")}
            </Text>
            <View style={styles.vehicleRow}>
              {options.map((v) => (
                <Pressable
                  key={v.key}
                  onPress={() => setVehicleFilter(v.key)}
                  style={[
                    styles.vehicleBtn,
                    {
                      borderColor: vehicleFilter === v.key ? "#F4B400" : cardBorder,
                      backgroundColor: vehicleFilter === v.key ? (dark ? "#2D2600" : "#FFFBEB") : bg,
                    },
                  ]}
                >
                  {v.icon}
                  <Text numberOfLines={1} style={[styles.vehicleBtnText, { color: vehicleFilter === v.key ? "#F4B400" : textSecondary }]}>
                    {ar ? v.labelAr : v.labelEn}
                  </Text>
                  <Text numberOfLines={1} style={[styles.vehicleBtnSub, { color: textSecondary }]}>
                    {ar ? v.subAr : v.subEn}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Price section */}
          <View style={[styles.priceContainer, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Pressable
              onPress={() => setPrice((prev) => Math.max(100000, prev - 50000))}
              style={[styles.priceBtn, { backgroundColor: dark ? "#F4B400" : "#111827" }]}
            >
              <Text style={[styles.priceBtnText, { color: dark ? "#111827" : "#fff" }]}>−</Text>
            </Pressable>

            <Pressable
              style={styles.priceDisplay}
              onPress={() => { setPriceInput(price.toString()); setShowPriceEdit(true); }}
            >
              <Text style={[styles.priceValue, { color: textPrimary }]}>{formatPrice(price)}</Text>
              <Text style={[styles.priceSub, { color: "#F4B400" }]}>
                {ar ? "✏ عرضك — اضغط لتعديله" : "✏ Your offer — tap to edit"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setPrice((prev) => prev + 50000)}
              style={[styles.priceBtn, { backgroundColor: dark ? "#F4B400" : "#111827" }]}
            >
              <Text style={[styles.priceBtnText, { color: dark ? "#111827" : "#fff" }]}>+</Text>
            </Pressable>
          </View>

          {/* Action row */}
          <View style={styles.actionRow}>
            {/* Note button — circular */}
            <Pressable
              onPress={() => setShowNote(true)}
              style={[styles.noteBtn, { backgroundColor: btnBg, borderColor: btnBorder }]}
            >
              <Feather name="message-square" size={20} color={note ? "#F4B400" : textSecondary} />
              {note ? <View style={styles.noteDot} /> : null}
            </Pressable>

            {/* Find driver button */}
            <Pressable
              onPress={findOffer}
              disabled={loading || fetchingRoute}
              style={[
                styles.findBtn,
                (loading || fetchingRoute) && { backgroundColor: dark ? "#334155" : "#E5E7EB" },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <>
                  <MaterialIcons name="search" size={20} color="#111827" style={{ marginRight: 6 }} />
                  <Text style={styles.findBtnText}>
                    {ar ? "ابحث عن سائق" : "Find Driver"} · {formatPrice(price)}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {/* PRICE EDIT MODAL */}
      <Modal visible={showPriceEdit} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: dark ? "#1E293B" : "#fff" }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: textPrimary }]}>{ar ? "تعديل السعر" : "Set Custom Price"}</Text>
            <Text style={[styles.modalSub, { color: textSecondary }]}>
              {ar ? "أدخل المبلغ بالليرة اللبنانية" : "Amount in Lebanese Pounds"}
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: cardBg, borderColor: cardBorder, color: textPrimary }]}
              value={priceInput}
              onChangeText={(t) => setPriceInput(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="100000"
              placeholderTextColor={textSecondary}
            />
            {!!priceInput && (
              <Text style={[styles.modalSub, { color: "#F4B400", marginBottom: 16 }]}>
                {parseInt(priceInput).toLocaleString()} {ar ? "ل.ل" : "L.L"}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setShowPriceEdit(false)}
                style={[styles.modalBtn, { backgroundColor: dark ? "#334155" : "#F1F5F9", flex: 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: textPrimary }]}>{ar ? "إلغاء" : "Cancel"}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const val = parseInt(priceInput);
                  if (val >= 50000) setPrice(val);
                  setShowPriceEdit(false);
                }}
                style={[styles.modalBtn, { backgroundColor: "#F4B400", flex: 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: "#111827" }]}>{ar ? "تأكيد" : "Confirm"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* NOTE MODAL */}
      <Modal visible={showNote} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: dark ? "#1E293B" : "#fff" }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: textPrimary }]}>{ar ? "إضافة ملاحظة" : "Add a Note"}</Text>
            <Text style={[styles.modalSub, { color: textSecondary }]}>
              {ar ? "رسالة اختيارية للسائق" : "Optional message for your driver"}
            </Text>
            <TextInput
              style={[styles.noteInput, { backgroundColor: cardBg, borderColor: cardBorder, color: textPrimary }]}
              placeholder={ar ? "مثل: اتصل بي عند الوصول..." : "e.g. Call me when you arrive..."}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={4}
              placeholderTextColor={textSecondary}
              textAlign={ar ? "right" : "left"}
            />
            <Pressable
              onPress={() => setShowNote(false)}
              style={[styles.modalBtn, { backgroundColor: "#F4B400" }]}
            >
              <Text style={[styles.modalBtnText, { color: "#111827" }]}>{ar ? "حفظ الملاحظة" : "Save Note"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  markerA: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: "#111827",
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#fff",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  markerB: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: "#F4B400",
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#fff",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  markerLabel: { color: "#fff", fontSize: 11, fontWeight: "900" },

  routeLoading: {
    position: "absolute", top: 60, alignSelf: "center",
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4,
  },

  bottomCard: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 36,
    maxHeight: "60%",
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 14, elevation: 14,
  },

  // Trip info strip
  tripStrip: {
    flexDirection: "row", borderRadius: 16, padding: 14,
    marginBottom: 12, borderWidth: 1,
  },
  tripItem:    { flex: 1, alignItems: "center", gap: 3 },
  tripValue:   { fontSize: 15, fontWeight: "800" },
  tripLabel:   { fontSize: 11 },
  tripDivider: { width: 1, marginHorizontal: 8 },

  // Section card
  section: {
    borderRadius: 16, borderWidth: 1,
    padding: 14, marginBottom: 12,
  },

  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 },
  vehicleRow: { flexDirection: 'row', gap: 8 },
  vehicleBtn: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 10, alignItems: 'center', gap: 4 },
  vehicleBtnText: { fontSize: 11, fontWeight: '700' },
  vehicleBtnSub: { fontSize: 9, fontWeight: '600', marginTop: 1 },
  priceContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, borderWidth: 1, padding: 10, marginBottom: 12 },
  priceBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  priceBtnText: { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  priceDisplay: { alignItems: 'center' },
  priceValue: { fontSize: 22, fontWeight: '900' },
  priceSub: { fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  noteBtn: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  noteDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: '#F4B400' },
  findBtn: { flex: 1, backgroundColor: '#F4B400', borderRadius: 18, height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#F4B400', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.38, shadowRadius: 10, elevation: 7 },
  findBtnText: { color: '#111827', fontSize: 15, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 44 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { fontSize: 13, marginBottom: 16 },
  modalInput: { borderRadius: 14, borderWidth: 1.5, padding: 16, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  noteInput: { borderRadius: 14, borderWidth: 1.5, padding: 14, fontSize: 15, height: 110, textAlignVertical: 'top', marginBottom: 16 },
  modalBtn: { borderRadius: 14, padding: 16, alignItems: 'center' },
  modalBtnText: { fontSize: 16, fontWeight: '800' },
});
