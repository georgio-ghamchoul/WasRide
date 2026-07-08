import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import MapView, { PROVIDER_DEFAULT } from "react-native-maps";

export default function DriverHomeScreen() {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [driverData, setDriverData] = useState<any>(null);
  const [incomingRequest, setIncomingRequest] = useState<any>(null);
  const [countdown, setCountdown] = useState(15);
  const [location, setLocation] = useState<any>(null);
  const mapRef = useRef<MapView>(null);

  // Searching animation
  const scale1 = useRef(new Animated.Value(1)).current;
  const scale2 = useRef(new Animated.Value(1)).current;
  const scale3 = useRef(new Animated.Value(1)).current;
  const opacity1 = useRef(new Animated.Value(0.8)).current;
  const opacity2 = useRef(new Animated.Value(0.5)).current;
  const opacity3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    loadDriverData();
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    startPulseAnimation();
  }, [isOnline]);

  useEffect(() => {
    if (!driverData) return;
    const channel = supabase
      .channel('driver_requests_' + driverData.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ride_requests',
        filter: `driver_id=eq.${driverData.id}`
      }, (payload) => {
        handleIncomingRequest(payload.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [driverData]);

  useEffect(() => {
    if (!incomingRequest) return;
    setCountdown(15);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleIgnore();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [incomingRequest]);

  function startPulseAnimation() {
    const pulse = (animScale: Animated.Value, animOpacity: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(animScale, {
              toValue: 2.5,
              duration: 1500,
              useNativeDriver: true,
            }),
            Animated.timing(animOpacity, {
              toValue: 0,
              duration: 1500,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(animScale, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(animOpacity, {
              toValue: 0.8,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ])
      ).start();
    };

    pulse(scale1, opacity1, 0);
    pulse(scale2, opacity2, 500);
    pulse(scale3, opacity3, 1000);
  }

  async function loadDriverData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('drivers')
      .select('*')
      .eq('id', user.id)
      .single();
    if (data) {
      setDriverData(data);
      setIsOnline(data.is_online === true);
    }
  }

  async function handleIncomingRequest(request: any) {
    const { data: ride } = await supabase
      .from('rides')
      .select('*')
      .eq('id', request.ride_id)
      .single();
    setIncomingRequest({ ...request, ride });
  }

  async function toggleOnline() {
    if (!driverData) return;
    setLoading(true);

    if (!isOnline) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission is required to go online');
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      mapRef.current?.animateToRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
      await supabase.from('drivers').update({
        is_online: true,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      }).eq('id', driverData.id);
      setIsOnline(true);
    } else {
      await supabase.from('drivers').update({ is_online: false }).eq('id', driverData.id);
      setIsOnline(false);
      scale1.setValue(1);
      scale2.setValue(1);
      scale3.setValue(1);
      opacity1.setValue(0.8);
      opacity2.setValue(0.5);
      opacity3.setValue(0.3);
    }
    setLoading(false);
  }

  async function handleAccept() {
    if (!incomingRequest) return;
    await supabase.from('ride_requests').update({ status: 'accepted' }).eq('id', incomingRequest.id);
    await supabase.from('rides').update({ status: 'accepted', driver_id: driverData.id }).eq('id', incomingRequest.ride_id);
    await supabase.from('drivers').update({ status: 'busy' }).eq('id', driverData.id);
    setIncomingRequest(null);
    router.push({ pathname: '/driver/trip', params: { rideId: incomingRequest.ride_id } });
  }

  async function handleIgnore() {
    if (!incomingRequest) return;
    await supabase.from('ride_requests').update({ status: 'ignored' }).eq('id', incomingRequest.id);
    setIncomingRequest(null);
  }

  return (
    <View style={{ flex: 1 }}>

      {/* MAP BACKGROUND */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: location?.latitude ?? 34.4667,
          longitude: location?.longitude ?? 36.2833,
          
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation
      />

      {/* TOP BAR */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>🏍️ {driverData?.full_name || 'Driver'}</Text>
        <Pressable onPress={async () => {
          await supabase.auth.signOut();
          router.replace('/login');
        }}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>

      {/* SEARCHING ANIMATION */}
      {isOnline && !incomingRequest && (
        <View style={styles.searchingContainer}>
          <View style={styles.pulseWrapper}>
            <Animated.View style={[styles.pulseCircle, styles.pulse1, { transform: [{ scale: scale1 }], opacity: opacity1 }]} />
            <Animated.View style={[styles.pulseCircle, styles.pulse2, { transform: [{ scale: scale2 }], opacity: opacity2 }]} />
            <Animated.View style={[styles.pulseCircle, styles.pulse3, { transform: [{ scale: scale3 }], opacity: opacity3 }]} />
            <View style={styles.centerDot}>
              <Text style={styles.centerDotText}>🏍️</Text>
            </View>
          </View>
          <Text style={styles.searchingText}>Searching for customers...</Text>
          <Text style={styles.searchingSubtext}>You are visible to nearby riders</Text>
        </View>
      )}

      {/* BOTTOM CARD */}
      <View style={styles.bottomCard}>

        {/* Offline State */}
        {!isOnline && !incomingRequest && (
          <View style={styles.offlineInfo}>
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineSubtitle}>
              Press Go Online to start receiving ride requests
            </Text>
          </View>
        )}

        {/* Go Online / Offline Button */}
        {!incomingRequest && (
          <Pressable
            onPress={toggleOnline}
            disabled={loading}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={[styles.onlineBtn, isOnline && styles.offlineBtn]}>
              <Text style={styles.onlineBtnText}>
                {loading ? '...' : isOnline ? '🔴 Go Offline' : '🟢 Go Online'}
              </Text>
            </View>
          </Pressable>
        )}

        {/* INCOMING REQUEST */}
        {incomingRequest && (
          <View style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestTitle}>🔔 New Request!</Text>
              <View style={styles.countdown}>
                <Text style={styles.countdownText}>{countdown}s</Text>
              </View>
            </View>

            <View style={styles.requestDetails}>
              <View style={styles.requestRow}>
                <Text style={styles.requestIcon}>📍</Text>
                <Text style={styles.requestText}>Pickup location</Text>
              </View>
              <View style={styles.requestRow}>
                <Text style={styles.requestIcon}>🏁</Text>
                <Text style={styles.requestText}>Destination</Text>
              </View>
              <View style={styles.requestRow}>
                <Text style={styles.requestIcon}>💰</Text>
                <Text style={styles.requestText}>
                  {incomingRequest?.ride?.price?.toLocaleString() || '100,000'} ل.ل
                </Text>
              </View>
              {incomingRequest?.ride?.note ? (
                <View style={styles.requestRow}>
                  <Text style={styles.requestIcon}>📝</Text>
                  <Text style={styles.requestText}>{incomingRequest.ride.note}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.requestButtons}>
              <Pressable onPress={handleIgnore} style={{ flex: 1 }}>
                <View style={styles.ignoreBtn}>
                  <Text style={styles.ignoreBtnText}>✕ Ignore</Text>
                </View>
              </Pressable>
              <Pressable onPress={handleAccept} style={{ flex: 1 }}>
                <View style={styles.acceptBtn}>
                  <Text style={styles.acceptBtnText}>✓ Accept</Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  signOutText: {
    fontSize: 14,
    color: "#EF4444",
    fontWeight: "600",
  },
  searchingContainer: {
    position: "absolute",
    top: "35%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pulseWrapper: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  pulseCircle: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#16A34A",
  },
  pulse1: { backgroundColor: "rgba(22,163,74,0.4)" },
  pulse2: { backgroundColor: "rgba(22,163,74,0.3)" },
  pulse3: { backgroundColor: "rgba(22,163,74,0.2)" },
  centerDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  centerDotText: {
    fontSize: 28,
  },
  searchingText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: "hidden",
  },
  searchingSubtext: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 6,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  bottomCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 36,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  offlineInfo: {
    marginBottom: 16,
  },
  offlineTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 4,
  },
  offlineSubtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  onlineBtn: {
    backgroundColor: "#16A34A",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  offlineBtn: {
    backgroundColor: "#EF4444",
  },
  onlineBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
  },
  requestCard: {
    gap: 12,
  },
  requestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  requestTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  countdown: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FEF9C3",
    borderWidth: 2,
    borderColor: "#F4B400",
    alignItems: "center",
    justifyContent: "center",
  },
  countdownText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  requestDetails: {
    gap: 10,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    padding: 14,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  requestIcon: { fontSize: 18 },
  requestText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "600",
  },
  requestButtons: {
    flexDirection: "row",
    gap: 10,
  },
  ignoreBtn: {
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  ignoreBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#6B7280",
  },
  acceptBtn: {
    backgroundColor: "#16A34A",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  acceptBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
});