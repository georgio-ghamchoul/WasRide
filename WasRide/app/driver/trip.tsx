import { useEffect, useRef, useState } from "react";
import {
  Alert, Pressable, TouchableOpacity, StyleSheet, Text, View, Image,
  Animated, PanResponder, Dimensions, ScrollView, Linking, BackHandler,
} from "react-native";
import CallModal, { type CallModalRef } from "@/components/CallModal";
import CancelReasonModal from "@/components/CancelReasonModal";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";
import { recordNotification } from "@/lib/inbox";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN = SCREEN_HEIGHT * 0.25;
const SHEET_MAX = SCREEN_HEIGHT * 0.78;

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8EC3B0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d3561" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4a7a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1b2a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1e2a3a" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#4b6a88" }] },
];

export default function DriverTripScreen() {
  const router = useRouter();
  const { activeRequest, locale, darkMode } = useAppState();
  const params = useLocalSearchParams();
  const ar = locale === 'ar';

  const bg = darkMode ? '#0F172A' : '#F9FAFB';
  const cardBg = darkMode ? '#1F2937' : '#FFFFFF';
  const textColor = darkMode ? '#FFFFFF' : '#111827';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  const mapRef = useRef<any>(null);
  const driverLocRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const fittedOnceRef = useRef(false);
  const lastFittedPhaseRef = useRef<string>('');

  // Parse coords passed from driver home screen so initialRegion is correct immediately
  const paramPickupLat = parseFloat(params.pickupLat as string);
  const paramPickupLng = parseFloat(params.pickupLng as string);
  const paramDropoffLat = parseFloat(params.dropoffLat as string);
  const paramDropoffLng = parseFloat(params.dropoffLng as string);
  const hasParamPickup = !isNaN(paramPickupLat) && !isNaN(paramPickupLng);
  const hasParamDropoff = !isNaN(paramDropoffLat) && !isNaN(paramDropoffLng);

  const [vehicleType, setVehicleType] = useState<string>('Motorcycle');
  const vehicleTypeRef = useRef<string>('Motorcycle');
  const [tripStatus, setTripStatus] = useState<'going_to_pickup' | 'arrived_at_pickup' | 'in_trip' | 'completed'>('going_to_pickup');
  const [riderComing, setRiderComing] = useState(false);
  const [rideId, setRideId] = useState<string | null>((params.rideId as string) || null);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const tripDoneRef = useRef(false);
  const [rider, setRider] = useState<any>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routeCoords, setRouteCoords] = useState<any[]>([]);
  const [eta, setEta] = useState<string>('');
  const [pickup, setPickup] = useState<{ latitude: number; longitude: number } | null>(
    hasParamPickup ? { latitude: paramPickupLat, longitude: paramPickupLng } : null
  );
  const [destination, setDestination] = useState<{ latitude: number; longitude: number } | null>(
    hasParamDropoff ? { latitude: paramDropoffLat, longitude: paramDropoffLng } : null
  );
  const [expanded, setExpanded] = useState(false);
  const [rideData, setRideData] = useState<any>(null);
  const [myDriverId, setMyDriverId] = useState('');
  const myDriverIdRef = useRef('');
  useEffect(() => { myDriverIdRef.current = myDriverId; }, [myDriverId]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const callModalRef = useRef<CallModalRef>(null);
  // Persistent broadcast channel for status updates — created once per ride,
  // reused for driver_arrived / trip_started / trip_completed.
  // Using a shared ref avoids the Supabase channel-cache bug where calling
  // supabase.channel(sameName) within 3 s of a prior call returns the cached
  // instance so subscribe() never fires again, silently dropping the broadcast.
  const statusChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const statusChReadyRef = useRef(false);

  // Bottom sheet
  const sheetY = useRef(new Animated.Value(SCREEN_HEIGHT - SHEET_MIN)).current;
  const lastY = useRef(SCREEN_HEIGHT - SHEET_MIN);
  const expandedRef = useRef(false); // always-fresh value for PanResponder closure

  function animateSheet(toExpanded: boolean) {
    const target = toExpanded ? SCREEN_HEIGHT - SHEET_MAX : SCREEN_HEIGHT - SHEET_MIN;
    lastY.current = target;
    expandedRef.current = toExpanded;
    setExpanded(toExpanded);
    Animated.spring(sheetY, { toValue: target, useNativeDriver: false, tension: 60, friction: 12 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const newY = lastY.current + g.dy;
        const clamped = Math.max(SCREEN_HEIGHT - SHEET_MAX, Math.min(SCREEN_HEIGHT - SHEET_MIN, newY));
        sheetY.setValue(clamped);
      },
      onPanResponderRelease: (_, g) => {
        // Tiny movement = tap → toggle
        if (Math.abs(g.dy) < 8 && Math.abs(g.dx) < 8) {
          animateSheet(!expandedRef.current);
          return;
        }
        const isExpand = g.dy < -30 || lastY.current < SCREEN_HEIGHT - SHEET_MIN - 60;
        animateSheet(isExpand);
      },
    })
  ).current;

  function toggleSheet() {
    animateSheet(!expandedRef.current);
  }

  // Load driver's own vehicle type once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMyDriverId(user.id);
      supabase.from('profiles').select('vehicle_type').eq('id', user.id).maybeSingle()
        .then(({ data }) => { if (data?.vehicle_type) { setVehicleType(data.vehicle_type); vehicleTypeRef.current = data.vehicle_type; } });
    });
  }, []);

  // Load ride data from route param
  useEffect(() => {
    const id = (params.rideId as string) || activeRequest?.id;
    if (!id) return;
    setRideId(id);
    supabase.from('rides')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRideData(data);
          const riderId = data.rider_id || data.passenger_id;
          if (riderId) { setRiderId(riderId); loadRider(riderId); }
          if (data.pickup_lat) setPickup({ latitude: data.pickup_lat, longitude: data.pickup_lng });
          if (data.dropoff_lat) setDestination({ latitude: data.dropoff_lat, longitude: data.dropoff_lng });
        }
      });
  }, [params.rideId, activeRequest?.id]);

  // Persistent status broadcast channel — set up once rideId is known.
  // All three driver status events (driver_arrived, trip_started, trip_completed)
  // send through this single channel so we never hit the Supabase channel-cache race.
  useEffect(() => {
    if (!rideId) return;
    statusChReadyRef.current = false;
    const ch = supabase.channel('ride_ch_' + rideId, { config: { broadcast: { ack: false } } });
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        statusChRef.current = ch;
        statusChReadyRef.current = true;
      }
    });
    return () => {
      statusChRef.current = null;
      statusChReadyRef.current = false;
      supabase.removeChannel(ch);
    };
  }, [rideId]);

  // Fit map to show both driver and pickup as soon as we have both — once only
  useEffect(() => {
    if (fittedOnceRef.current) return;
    if (!pickup || !driverLocation) return;
    fittedOnceRef.current = true;
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        [driverLocation, pickup],
        { edgePadding: { top: 100, right: 60, bottom: SHEET_MIN + 80, left: 60 }, animated: true }
      );
    }, 500);
  }, [driverLocation?.latitude, pickup?.latitude]);

  // GPS tracking — update driver location, push to DB, and broadcast to rider
  useEffect(() => {
    let sub: any;
    // Persistent broadcast channel — wait for SUBSCRIBED before sending any location
    let channelReady = false;
    const pendingLocations: { lat: number; lng: number }[] = [];
    const locCh = supabase.channel('ride_loc_' + (params.rideId as string), {
      config: { broadcast: { ack: false } },
    });
    locCh.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channelReady = true;
        // Flush any locations that were captured before subscription was ready
        for (const p of pendingLocations) {
          locCh.send({ type: 'broadcast', event: 'driver_location', payload: p });
        }
        pendingLocations.length = 0;
      }
    });

    function broadcastLocation(lat: number, lng: number) {
      if (channelReady) {
        locCh.send({ type: 'broadcast', event: 'driver_location', payload: { lat, lng } });
      } else {
        pendingLocations.push({ lat, lng });
      }
    }

    (async () => {
      // Pre-activate keep-awake — swallow if device/simulator doesn't support it.
      try { await activateKeepAwakeAsync(); } catch (_) {}

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      // Get immediate position — queued until channel is ready
      try {
        const immediate = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const loc = { latitude: immediate.coords.latitude, longitude: immediate.coords.longitude };
        driverLocRef.current = loc;
        setDriverLocation(loc);
        broadcastLocation(loc.latitude, loc.longitude);
      } catch {}
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15 },
        async (loc) => {
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          driverLocRef.current = coords;
          setDriverLocation(coords);
          // Update DB (fallback for riders who join late and read from DB)
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            supabase.from('driver_presence').upsert({ driver_id: user.id, latitude: coords.latitude, longitude: coords.longitude, is_online: true }, { onConflict: 'driver_id' });
          }
          // Broadcast to rider channel — bypasses RLS, delivers instantly
          broadcastLocation(coords.latitude, coords.longitude);
        }
      );
    })();
    return () => { sub?.remove?.(); supabase.removeChannel(locCh); deactivateKeepAwake().catch(() => {}); };
  }, []);

  // GOING TO PICKUP: re-fetch driver→pickup as driver moves, fit map once per phase.
  // ARRIVED: no route needed.
  // IN TRIP: re-fetch driver→dropoff as driver moves (shows remaining route shrinking).
  //          Only fit the map on the first fetch (phase change); after that driver pans freely.
  useEffect(() => {
    if (tripStatus === 'going_to_pickup') {
      if (!driverLocation || !pickup) return;
      const phaseChanged = lastFittedPhaseRef.current !== 'going_to_pickup';
      if (phaseChanged) lastFittedPhaseRef.current = 'going_to_pickup';
      fetchRoute(driverLocation, pickup, phaseChanged);
    } else if (tripStatus === 'in_trip') {
      if (!driverLocation || !destination) return;
      const phaseChanged = lastFittedPhaseRef.current !== 'in_trip';
      if (phaseChanged) lastFittedPhaseRef.current = 'in_trip';
      // Live route: driver GPS → dropoff. Fits map only on first tick, then updates silently.
      fetchRoute(driverLocation, destination, phaseChanged);
    }
  }, [driverLocation?.latitude, driverLocation?.longitude, tripStatus, pickup?.latitude, destination?.latitude]);

  async function fetchRoute(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
    shouldFit = false
  ) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes?.[0]) {
        const coords = (data.routes[0].geometry?.coordinates || []).map((c: number[]) => ({
          latitude: c[1], longitude: c[0],
        }));
        setRouteCoords(coords);
        const mins = Math.ceil(data.routes[0].duration / 60);
        setEta(`${mins} ${ar ? 'دقيقة' : 'min'}`);
        // Only fit the map when the phase just changed (first load or pickup→dropoff switch).
        // After that the driver can pan/zoom freely without the map jumping back.
        // Only fit map when going to pickup (driver→pickup framing).
        // In-trip zoom (pickup→dropoff) is handled directly in handleStartTrip.
        if (shouldFit && tripStatus !== 'in_trip') {
          setTimeout(() => {
            const midLat = (from.latitude + to.latitude) / 2;
            const midLng = (from.longitude + to.longitude) / 2;
            // Step 1: snap heading to north-up instantly
            mapRef.current?.animateCamera(
              { center: { latitude: midLat, longitude: midLng }, heading: 0, pitch: 0, zoom: 13 },
              { duration: 50 }
            );
            // Step 2: fit driver + pickup with sheet-aware padding
            setTimeout(() => {
              mapRef.current?.fitToCoordinates(
                [from, to],
                { edgePadding: { top: 80, right: 60, bottom: SHEET_MIN + 60, left: 60 }, animated: true }
              );
            }, 300);
          }, 300);
        }
      }
    } catch (e) { console.log('Route error:', e); }
  }

  // Send a status event on the persistent ride channel.
  // Falls back to a fresh ephemeral channel only if the persistent one isn't ready
  // (e.g. the driver taps "Arrived" in the first second before subscribe() fires).
  function sendStatusBroadcast(event: string, payload: Record<string, any>) {
    if (statusChReadyRef.current && statusChRef.current) {
      statusChRef.current.send({ type: 'broadcast', event, payload });
    } else {
      // Fallback — unique name avoids the cache collision that caused the original bug
      const ch = supabase.channel('ride_ch_fb_' + rideId + '_' + Date.now(), { config: { broadcast: { ack: false } } });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event, payload });
          setTimeout(() => supabase.removeChannel(ch), 4000);
        }
      });
    }
  }

  // Listen for rider_coming broadcast while waiting at pickup.
  // Channel name must match exactly what the rider sends on (see tracking.tsx handleRiderComing).
  useEffect(() => {
    if (!rideId || tripStatus !== 'arrived_at_pickup') return;
    const ch = supabase.channel('ride_rider_coming_' + rideId)
      .on('broadcast', { event: 'rider_coming' }, () => {
        setRiderComing(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rideId, tripStatus]);

  // Listen for ride cancellation by the rider
  useEffect(() => {
    if (!rideId) return;
    const ch = supabase
      .channel('ride_cancel_watch_' + rideId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      }, (payload) => {
        if (payload.new?.status === 'cancelled') {
          if (payload.new?.cancelled_by === 'driver' || tripDoneRef.current) return; // our own cancel
          Alert.alert(
            ar ? 'إلغاء الرحلة' : 'Trip Cancelled',
            ar ? 'قام الراكب بإلغاء الرحلة' : 'The rider has cancelled the trip',
            [{
              text: ar ? 'حسناً' : 'OK',
              onPress: () => router.replace({ pathname: '/driver/home', params: { autoOnline: 'true' } } as never),
            }]
          );
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rideId]);

  // Unread chat indicator — watch for new messages from the rider
  useEffect(() => {
    if (!rideId) return;
    const ch = supabase.channel('chat_unread_driver_' + rideId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        if (payload.new.sender_id !== myDriverIdRef.current) {
          setHasUnreadChat(true);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rideId]);

  async function loadRider(id: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, average_rating')
      .eq('id', id)
      .maybeSingle();
    if (data) {
      const photoUrl = supabase.storage.from('profile-images').getPublicUrl(`riders/${id}.jpg`).data.publicUrl;
      setRider({ ...data, rating: data.average_rating, profile_image: photoUrl });
    } else {
      console.log('loadRider error:', error);
    }
  }

  function handleArrived() {
    setTripStatus('arrived_at_pickup');
    setRouteCoords([]); // clear direction to pickup — driver is already there
    if (rideId) {
      supabase.from('rides').update({ status: 'driver_arrived' }).eq('id', rideId)
        .then(({ error }) => { if (error) console.log('handleArrived DB update failed:', error.message); });
      sendStatusBroadcast('driver_arrived', { rideId });
      if (riderId) recordNotification({ userId: riderId, type: 'ride', title: 'Driver arrived', body: 'Your driver has arrived at the pickup point.' }).catch(() => {});
    }
  }

  function computeBearing(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number }
  ): number {
    const dLng = (to.longitude - from.longitude) * Math.PI / 180;
    const lat1 = from.latitude * Math.PI / 180;
    const lat2 = to.latitude * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  async function handleStartTrip() {
    // Advance driver UI immediately — DB update may fail silently due to RLS (same pattern as
    // handleAccept in home.tsx). Rider status is protected by STATUS_RANK so it won't downgrade.
    setTripStatus('in_trip');
    if (rideId) {
      supabase.from('rides').update({ status: 'in_progress' }).eq('id', rideId)
        .then(({ error }) => { if (error) console.log('handleStartTrip DB update failed:', error.message); });
      sendStatusBroadcast('trip_started', { rideId });
      if (riderId) recordNotification({ userId: riderId, type: 'ride', title: 'Trip started', body: 'Your trip has started. Enjoy the ride!' }).catch(() => {});
    }
    // Rotate map so A (pickup) is at bottom, B (dropoff) is at top.
    // Set heading = bearing from A→B so that direction becomes "up" on screen.
    if (pickup && destination) {
      setTimeout(() => {
        const bearing = computeBearing(pickup, destination);
        const latDiff = destination.latitude - pickup.latitude;
        const lngDiff = destination.longitude - pickup.longitude;
        const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) || 0.01;
        // Shift center toward B to keep pickup above the bottom sheet
        const shiftFraction = SHEET_MIN / (2 * SCREEN_HEIGHT);
        const centerLat = (pickup.latitude + destination.latitude) / 2 + latDiff * shiftFraction;
        const centerLng = (pickup.longitude + destination.longitude) / 2 + lngDiff * shiftFraction;
        const zoom = Math.max(10, Math.min(Math.floor(Math.log2(712 / dist)), 16));
        mapRef.current?.animateCamera({
          center: { latitude: centerLat, longitude: centerLng },
          heading: bearing,
          pitch: 0,
          zoom,
        }, { duration: 800 });
      }, 400);
    }
  }

  // Driver cancellation — opens reason picker; leaving the screen routes here too.
  async function confirmDriverCancel(reason: string) {
    setShowCancelModal(false);
    tripDoneRef.current = true; // suppress our own cancel watcher
    if (rideId) {
      await supabase.from('rides')
        .update({ status: 'cancelled', cancel_reason: reason, cancelled_by: 'driver' })
        .eq('id', rideId);
      // Let the rider's app know immediately.
      sendStatusBroadcast('trip_cancelled', { rideId });
      if (riderId) recordNotification({ userId: riderId, type: 'ride', title: 'Trip cancelled', body: 'Your driver cancelled the trip. You can request another ride.' }).catch(() => {});
    }
    router.replace({ pathname: '/driver/home', params: { autoOnline: 'true' } } as never);
  }

  // Block the Android hardware back — leaving = cancel-with-reason.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tripDoneRef.current) return false; // allow leaving once completed/cancelled
      setShowCancelModal(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  function handleEndTrip() {
    Alert.alert(
      ar ? 'إنهاء الرحلة' : 'End Trip',
      ar ? 'هل تأكد أن الرحلة اكتملت؟' : 'Confirm trip is completed?',
      [
        { text: ar ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: ar ? 'إنهاء' : 'Complete',
          onPress: async () => {
            if (rideId) {
              const { error: completeErr } = await supabase.from('rides').update({ status: 'completed' }).eq('id', rideId);
              if (completeErr) console.log('driver complete-write error:', completeErr.message);
              // Broadcast so the rider's app also writes 'completed' as a reliable
              // fallback (the rider always passes the rides RLS update policy).
              sendStatusBroadcast('trip_completed', { rideId });
              if (riderId) recordNotification({ userId: riderId, type: 'ride', title: 'Trip completed', body: 'Your trip is complete. Thanks for riding with us!' }).catch(() => {});
            }
            // Increment trips_completed on the driver's profile so the count is accurate
            const driverId = myDriverIdRef.current;
            if (driverId) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('trips_completed')
                .eq('id', driverId)
                .maybeSingle();
              const newCount = (prof?.trips_completed ?? 0) + 1;
              await supabase.from('profiles').update({ trips_completed: newCount }).eq('id', driverId);
            }
            tripDoneRef.current = true;
            setTripStatus('completed');
            let riderToRate = riderId;
            if (!riderToRate && rideId) {
              const { data } = await supabase.from('rides').select('rider_id, passenger_id').eq('id', rideId).maybeSingle();
              riderToRate = data?.rider_id || data?.passenger_id || null;
            }
            router.replace({
              pathname: '/trip-rating',
              params: { rideId: rideId || 'unknown', toUserId: riderToRate || '', toRole: 'rider', autoOnline: 'true' },
            } as never);
          },
        },
      ]
    );
  }

  const riderFullName = rider?.full_name || (ar ? 'الراكب' : 'Rider');

  const targetCoord = tripStatus === 'going_to_pickup' ? pickup : destination;

  const statusText =
    tripStatus === 'going_to_pickup'   ? (ar ? '🚗 في الطريق إلى الراكب' : '🚗 Going to pickup') :
    tripStatus === 'arrived_at_pickup' ? (ar ? '📍 وصلت إلى نقطة الاستلام' : '📍 Arrived at pickup') :
    tripStatus === 'in_trip'           ? (ar ? '🏁 الرحلة جارية' : '🏁 Trip in progress') :
                                         (ar ? '✅ اكتملت الرحلة' : '✅ Trip completed');

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>

      {/* MAP */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        customMapStyle={darkMode ? darkMapStyle : undefined}
        showsUserLocation
        initialRegion={{
          latitude: hasParamPickup ? paramPickupLat : (pickup?.latitude ?? 33.8938),
          longitude: hasParamPickup ? paramPickupLng : (pickup?.longitude ?? 35.5018),
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        }}
      >
        {/* Route line — dashed while going to pickup, solid during trip */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#F4B400"
            strokeWidth={4}
            lineDashPattern={tripStatus === 'going_to_pickup' ? [1] : undefined}
          />
        )}

        {/* Driver's own location marker */}
        {driverLocation && (
          <Marker coordinate={driverLocation} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.driverMarker}>
              <Text style={{ fontSize: 18 }}>
                {rideData?.service === 'couriers' ? '📦' : vehicleType === 'Tuktuk' ? '🛺' : vehicleType === 'Car' ? '🚗' : '🏍'}
              </Text>
            </View>
          </Marker>
        )}

        {/* Pickup marker (A) — visible throughout trip, hidden only on completed */}
        {pickup && tripStatus !== 'completed' && (
          <Marker coordinate={pickup}>
            <View style={styles.markerGreen}>
              <Text style={styles.markerLabel}>A</Text>
            </View>
          </Marker>
        )}

        {/* Destination marker (B) — always visible */}
        {destination && (
          <Marker coordinate={destination}>
            <View style={styles.markerRed}>
              <Text style={styles.markerLabel}>B</Text>
            </View>
          </Marker>
        )}
      </MapView>

      {/* STATUS BANNER */}
      <View style={[styles.statusBanner, { backgroundColor: cardBg }]}>
        <Text style={[styles.statusText, { color: textColor }]}>{statusText}</Text>
        {eta && tripStatus !== 'arrived_at_pickup' ? (
          <Text style={styles.etaText}>
            {tripStatus === 'in_trip'
              ? (ar ? `الوصول للوجهة خلال ~${eta}` : `To destination in ~${eta}`)
              : (ar ? `الوصول للراكب خلال ~${eta}` : `To pickup in ~${eta}`)}
          </Text>
        ) : null}
      </View>

      {/* OPEN NAVIGATION BUTTON */}
      {targetCoord && (
        <Pressable
          style={[styles.navBtn, { backgroundColor: cardBg, borderColor }]}
          onPress={() => Linking.openURL(
            `https://www.google.com/maps/dir/?api=1&destination=${targetCoord.latitude},${targetCoord.longitude}&travelmode=driving`
          )}
        >
          <Text style={[styles.navBtnText, { color: textColor }]}>🧭 {ar ? 'فتح الخريطة' : 'Navigate'}</Text>
        </Pressable>
      )}

      {/* BOTTOM SHEET */}
      <Animated.View style={[styles.sheet, { top: sheetY, backgroundColor: cardBg }]}>

        {/* DRAG HANDLE — panHandlers on the View directly; tap/swipe both handled in PanResponder */}
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
          <Text style={styles.swipeHint}>
            {expanded
              ? (ar ? '▼ اسحب للأسفل' : '▼ Swipe down')
              : (ar ? '▲ اسحب لأعلى لرؤية الراكب' : '▲ Swipe up to see rider')}
          </Text>
        </View>

        <ScrollView
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 48 }}
        >

          {/* RIDER PROFILE CARD */}
          <View style={styles.riderCard}>
            {/* Avatar — tapping opens rider profile */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => { if (riderId) router.push(('/driver-profile/' + riderId) as never); }}
              style={styles.riderAvatarTap}
            >
              {rider?.profile_image ? (
                <Image source={{ uri: rider.profile_image }} style={styles.riderPhoto}
                  onError={() => setRider((r: any) => r ? { ...r, profile_image: null } : r)} />
              ) : (
                <View style={styles.riderPhotoPlaceholder}>
                  <Text style={styles.riderInitial}>{riderFullName?.[0]?.toUpperCase() || '?'}</Text>
                </View>
              )}
              <Text style={styles.viewProfileHint}>{ar ? 'عرض الملف' : 'View Profile'}</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.riderLabel}>{ar ? 'الراكب' : 'Rider'}</Text>
              <Text style={[styles.riderName, { color: textColor }]}>{riderFullName}</Text>
              {rider?.rating != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  {[1,2,3,4,5].map(i => (
                    <Text key={i} style={{ fontSize: 14, color: i <= Math.round(Number(rider.rating) || 0) ? '#F4B400' : (darkMode ? '#374151' : '#D1D5DB') }}>★</Text>
                  ))}
                  <Text style={styles.ratingNum}>{Number(rider.rating).toFixed(1)}</Text>
                </View>
              ) : (
                <Text style={styles.ratingNum}>⭐ 5.0</Text>
              )}
            </View>

            {/* Chat + Call buttons */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {riderId && (
                <Pressable
                  onPress={() => {
                    setHasUnreadChat(false);
                    router.push({
                      pathname: '/chat' as never,
                      params: {
                        rideId: rideId || '',
                        otherUserId: riderId,
                        otherName: riderFullName,
                        otherImage: rider?.profile_image || '',
                        otherPhone: rider?.phone || '',
                        role: 'rider',
                      },
                    } as never);
                  }}
                  style={[styles.chatBtn, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}
                >
                  <Text style={{ fontSize: 22 }}>💬</Text>
                  {hasUnreadChat && (
                    <View style={[styles.unreadDot, { borderColor: cardBg }]} />
                  )}
                </Pressable>
              )}
              {riderId && (
                <Pressable
                  onPress={() => {
                    // Place a real phone call when we have the rider's number
                    // (the in-app voice engine only works in native builds, not Expo Go).
                    const phone = (rider?.phone || '').replace(/\s/g, '');
                    if (phone) {
                      Linking.openURL(`tel:${phone}`).catch(() => callModalRef.current?.startCall());
                    } else {
                      callModalRef.current?.startCall();
                    }
                  }}
                  style={[styles.chatBtn, { backgroundColor: '#16A34A' }]}
                >
                  <Text style={{ fontSize: 22 }}>📞</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* DIVIDER */}
          <View style={[styles.divider, { backgroundColor: borderColor }]} />

          {/* TRIP DETAILS */}
          <View style={styles.detailsBlock}>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#16A34A' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>{ar ? 'الاستلام' : 'Pickup'}</Text>
                <Text style={[styles.routeValue, { color: textColor }]}>
                  {activeRequest?.pickupLabel || (ar ? 'موقع الاستلام' : 'Pickup location')}
                </Text>
              </View>
            </View>
            <View style={styles.routeConnector} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#EF4444' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>{ar ? 'الوجهة' : 'Destination'}</Text>
                <Text style={[styles.routeValue, { color: textColor }]}>
                  {activeRequest?.destinationLabel || (ar ? 'الوجهة' : 'Destination')}
                </Text>
              </View>
            </View>
          </View>

          {/* FARE */}
          <View style={[styles.fareRow, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={styles.fareLabel}>{ar ? 'الأجرة' : 'Fare'}</Text>
            <Text style={[styles.fareValue, { color: textColor }]}>
              💵 {rideData?.price
                ? parseInt(rideData.price).toLocaleString() + (ar ? ' ل.ل' : ' L.L')
                : (ar ? '100,000 ل.ل' : '100,000 L.L')}
            </Text>
          </View>

          {(rideData?.description || activeRequest?.description) ? (
            <View style={[styles.noteRow, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
              <Text style={{ fontSize: 16 }}>📝</Text>
              <Text style={styles.noteText}>{rideData?.description || activeRequest?.description}</Text>
            </View>
          ) : null}

          <View style={{ height: 16 }} />

          {/* ACTION BUTTONS */}
          {tripStatus === 'going_to_pickup' && (
            <Pressable onPress={handleArrived} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>
                {ar ? '📍 وصلت إلى الراكب' : '📍 I\'ve Arrived'}
              </Text>
            </Pressable>
          )}

          {tripStatus === 'arrived_at_pickup' && (
            <>
              {riderComing && (
                <View style={styles.riderComingBanner}>
                  <Text style={styles.riderComingText}>
                    {ar ? '🚶 الراكب في الطريق إليك!' : '🚶 Rider is on the way to you!'}
                  </Text>
                </View>
              )}
              <Pressable onPress={handleStartTrip} style={[styles.primaryBtn, { backgroundColor: '#2563EB' }]}>
                <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                  {ar ? '🚀 ابدأ الرحلة' : '🚀 Start Trip'}
                </Text>
              </Pressable>
            </>
          )}

          {tripStatus === 'in_trip' && (
            <Pressable onPress={handleEndTrip} style={[styles.primaryBtn, { backgroundColor: '#16A34A' }]}>
              <Text style={[styles.primaryBtnText, { color: '#fff' }]}>
                {ar ? '🏁 إنهاء الرحلة' : '🏁 End Trip'}
              </Text>
            </Pressable>
          )}

          {tripStatus === 'completed' && (
            <Pressable
              onPress={() => router.replace({
                pathname: '/trip-rating',
                params: { rideId: rideId || 'unknown', toUserId: riderId || '', toRole: 'rider', autoOnline: 'true' },
              } as never)}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>{ar ? '⭐ قيّم الراكب' : '⭐ Rate the Rider'}</Text>
            </Pressable>
          )}

        </ScrollView>
      </Animated.View>
      {/* ── IN-APP CALL ── */}
      {myDriverId && riderId && rideId && (
        <CallModal
          ref={callModalRef}
          rideId={rideId}
          myId={myDriverId}
          myName=""
          otherUserId={riderId}
          otherName={rider?.full_name || (ar ? 'الراكب' : 'Rider')}
          locale={locale}
          darkMode={darkMode}
        />
      )}

      {/* ── CANCEL REASON ── */}
      <CancelReasonModal
        visible={showCancelModal}
        role="driver"
        ar={ar}
        darkMode={darkMode}
        onClose={() => setShowCancelModal(false)}
        onConfirm={confirmDriverCancel}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  driverMarker: {
    backgroundColor: '#fff', borderRadius: 20, width: 38, height: 38,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
    borderWidth: 2, borderColor: '#F4B400',
  },
  markerGreen: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#16A34A',
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  markerRed: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  markerLabel: { color: '#fff', fontSize: 11, fontWeight: '900' },

  // Status banner
  statusBanner: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: '#1E293B', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10, gap: 2,
  },
  statusText: { color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  etaText: { color: '#F4B400', fontWeight: '700', fontSize: 13, textAlign: 'center' },

  // Navigate button
  navBtn: {
    position: 'absolute', top: 128, right: 16,
    backgroundColor: '#F4B400', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  navBtnText: { color: '#111827', fontWeight: '800', fontSize: 13 },

  // Bottom sheet
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#111827', borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  handleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#374151', marginBottom: 6 },
  swipeHint: { color: '#4B5563', fontSize: 11, fontWeight: '600' },

  // Rider card
  riderCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  riderAvatarTap: { alignItems: 'center', gap: 4, marginRight: 14 },
  viewProfileHint: { color: '#F4B400', fontSize: 10, fontWeight: '700' },
  riderPhoto: { width: 64, height: 64, borderRadius: 32 },
  riderPhotoPlaceholder: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#F4B400', alignItems: 'center', justifyContent: 'center',
  },
  riderInitial: { fontSize: 26, fontWeight: '900', color: '#111827' },
  riderLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  riderName: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 2 },
  ratingNum: { color: '#9CA3AF', fontSize: 13, fontWeight: '700', marginLeft: 4 },
  unreadDot: { position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#EF4444', borderWidth: 2 },
  chatBtn: {
    position: 'relative', width: 48, height: 48, borderRadius: 24, backgroundColor: '#1F2937',
    alignItems: 'center', justifyContent: 'center',
  },

  // Divider
  divider: { height: 1, backgroundColor: '#1F2937', marginHorizontal: 20 },

  // Trip details
  detailsBlock: { paddingHorizontal: 20, paddingVertical: 16, gap: 0 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  routeConnector: { width: 2, height: 18, backgroundColor: '#374151', marginLeft: 5, marginVertical: 4 },
  routeLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  routeValue: { color: '#D1D5DB', fontSize: 14, fontWeight: '600', marginTop: 2 },

  // Fare
  fareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1F2937', borderRadius: 14,
    marginHorizontal: 20, padding: 14, marginBottom: 10,
  },
  fareLabel: { color: '#6B7280', fontSize: 13, fontWeight: '700' },
  fareValue: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Note
  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1F2937', borderRadius: 14,
    marginHorizontal: 20, padding: 14, marginBottom: 10,
  },
  noteText: { color: '#9CA3AF', fontSize: 14, flex: 1 },

  // Action button
  primaryBtn: {
    backgroundColor: '#F4B400', borderRadius: 18,
    marginHorizontal: 20, padding: 20, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 17, fontWeight: '900', color: '#111827' },

  riderComingBanner: {
    backgroundColor: '#14532D', borderRadius: 14,
    marginHorizontal: 20, marginBottom: 10,
    paddingVertical: 12, paddingHorizontal: 16,
    alignItems: 'center',
  },
  riderComingText: { color: '#86EFAC', fontWeight: '800', fontSize: 14 },
});
