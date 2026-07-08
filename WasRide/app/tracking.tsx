import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/app-state";
import {
  View, Text, StyleSheet, Pressable, TouchableOpacity, Modal, Linking, Alert,
  Animated, PanResponder, Dimensions, ScrollView, Image, Vibration, BackHandler,
} from "react-native";
import { useRouter, useLocalSearchParams, useRootNavigationState } from "expo-router";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { supabase } from "@/lib/supabase";
import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { sendLocalDriverArrivedNotification, sendLocalTripStartedNotification } from "@/lib/notifications";
import CallModal, { type CallModalRef } from "@/components/CallModal";
import CancelReasonModal from "@/components/CancelReasonModal";
import { recordRiderCancel, resetCancelCount, CANCEL_LOCK_MINUTES } from "@/lib/cancel-limits";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN = SCREEN_HEIGHT * 0.28;   // collapsed — just ETA + vehicle
const SHEET_MAX = SCREEN_HEIGHT * 0.78;   // expanded — full details

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#373737" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
];

export default function TrackingScreen() {
  const router = useRouter();
  const {
    rideId, driverId: paramDriverId,
    pickupLat: paramPickupLat, pickupLng: paramPickupLng,
    dropoffLat: paramDropoffLat, dropoffLng: paramDropoffLng,
    vehicleType: paramVehicleType,
    driverLat: paramDriverLat, driverLng: paramDriverLng,
    driverName: paramDriverName, driverPhone: paramDriverPhone,
  } = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#FFFFFF';
  const cardBg = darkMode ? '#1F2937' : '#FFFFFF';
  const textColor = darkMode ? '#FFFFFF' : '#111827';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  // Navigation-ready guard: prevents "navigate before mounting the Root Layout"
  // when a ride is already cancelled/completed as this screen first loads.
  const rootNavState = useRootNavigationState();
  const navReadyRef = useRef(false);
  const pendingHomeRef = useRef(false);
  useEffect(() => {
    navReadyRef.current = !!rootNavState?.key;
    if (navReadyRef.current && pendingHomeRef.current) {
      pendingHomeRef.current = false;
      router.replace('/' as never);
    }
  }, [rootNavState?.key]);
  function goHome() {
    if (navReadyRef.current) router.replace('/' as never);
    else pendingHomeRef.current = true;
  }

  const mapRef = useRef<MapView>(null);
  const riderLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const driverLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const rideRef = useRef<any>(null);
  const driverRef = useRef<any>(null);
  const mapFittedRef = useRef(false);
  const [ride, setRide] = useState<any>(null);
  const [driver, setDriver] = useState<any>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [riderLocation, setRiderLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [showSafety, setShowSafety] = useState(false);
  const [eta, setEta] = useState<number | null>(null);
  const [waitTime, setWaitTime] = useState(0);
  const [driverImageError, setDriverImageError] = useState(false);
  const [driverVehicleType, setDriverVehicleType] = useState<string>((paramVehicleType as string) || '');
  const [expanded, setExpanded] = useState(false);
  const [myUserId, setMyUserId] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const myUserIdRef = useRef('');
  useEffect(() => { myUserIdRef.current = myUserId; }, [myUserId]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const callModalRef = useRef<CallModalRef>(null);
  const [tripStatus, setTripStatus] = useState<'going_to_pickup' | 'driver_arrived' | 'in_progress' | 'completed'>('going_to_pickup');
  const [riderComing, setRiderComing] = useState(false);
  // Keep a ref to the broadcast channel so we can send on it without creating a duplicate
  const broadcastChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Ref that always holds the latest tripStatus — used in polling callback to prevent
  // downgrading status (e.g. polling seeing driver_arrived after broadcast set in_progress).
  const tripStatusRef = useRef<string>('going_to_pickup');
  useEffect(() => { tripStatusRef.current = tripStatus; }, [tripStatus]);
  // Status rank — higher = further along in the trip lifecycle.
  const STATUS_RANK: Record<string, number> = {
    going_to_pickup: 0, accepted: 0,
    driver_arrived: 1,
    in_progress: 2,
    completed: 3,
    cancelled: 4,
  };

  // Bottom sheet animation
  const sheetY = useRef(new Animated.Value(SCREEN_HEIGHT - SHEET_MIN)).current;
  const lastY = useRef(SCREEN_HEIGHT - SHEET_MIN);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const newY = lastY.current + g.dy;
        const clamped = Math.max(SCREEN_HEIGHT - SHEET_MAX, Math.min(SCREEN_HEIGHT - SHEET_MIN, newY));
        sheetY.setValue(clamped);
      },
      onPanResponderRelease: (_, g) => {
        const isExpand = g.dy < -40 || lastY.current < SCREEN_HEIGHT - SHEET_MIN - 60;
        const target = isExpand ? SCREEN_HEIGHT - SHEET_MAX : SCREEN_HEIGHT - SHEET_MIN;
        lastY.current = target;
        setExpanded(isExpand);
        Animated.spring(sheetY, { toValue: target, useNativeDriver: false, tension: 60, friction: 12 }).start();
      },
    })
  ).current;

  function toggleSheet() {
    const target = expanded ? SCREEN_HEIGHT - SHEET_MIN : SCREEN_HEIGHT - SHEET_MAX;
    lastY.current = target;
    setExpanded(!expanded);
    Animated.spring(sheetY, { toValue: target, useNativeDriver: false, tension: 60, friction: 12 }).start();
  }

  useEffect(() => { rideRef.current = ride; }, [ride]);
  useEffect(() => { driverRef.current = driver; }, [driver]);

  // Pre-populate driver info from navigation params (avoids RLS delay)
  useEffect(() => {
    const lat = paramDriverLat ? parseFloat(paramDriverLat as string) : NaN;
    const lng = paramDriverLng ? parseFloat(paramDriverLng as string) : NaN;
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      const loc = { latitude: lat, longitude: lng };
      driverLocationRef.current = loc;
      setDriverLocation(loc);
    }
    const name = paramDriverName as string;
    const phone = paramDriverPhone as string;
    const vt = paramVehicleType as string;
    if (vt) setDriverVehicleType(vt);
    if (name) {
      const id = paramDriverId as string;
      const photoUrl = id ? supabase.storage.from('driver-images').getPublicUrl(`drivers/${id}.jpg`).data.publicUrl : '';
      const preDriver = { id, full_name: name, phone: phone || '', vehicle_type: vt || '', driver_image: photoUrl, rating: null };
      driverRef.current = preDriver;
      setDriver(preDriver);
    }
  }, []);

  useEffect(() => {
    loadRide();
    startRiderLocation();
    // Get current user ID for call signaling
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setMyUserId(user.id);
    });
    // Block the Android hardware back button — leaving = cancel-with-reason.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tripStatusRef.current === 'completed') return false; // allow leaving after completion
      setShowCancelModal(true);
      return true; // swallow the back press
    });
    return () => { deactivateKeepAwake().catch(() => {}); sub.remove(); };
  }, []);

  // Load driver info as soon as we have any driver ID (param or from ride row)
  useEffect(() => {
    const id = (paramDriverId as string) || ride?.driver_id;
    if (!id) return;
    loadDriverById(id);
    // Load vehicle type independently so the map marker is always correct
    supabase.from('public_profiles').select('vehicle_type').eq('id', id).maybeSingle()
      .then(({ data }) => { if (data?.vehicle_type) setDriverVehicleType(data.vehicle_type); });
  }, [paramDriverId, ride?.driver_id]);

  // Driver GPS broadcast — stable subscription that never tears down mid-trip.
  // Depends only on rideId so it is NOT recreated when ride data loads.
  useEffect(() => {
    if (!rideId) return;
    const locCh = supabase.channel('ride_loc_' + rideId)
      .on('broadcast', { event: 'driver_location' }, (msg) => {
        const { lat, lng } = msg.payload;
        if (lat && lng) {
          const loc = { latitude: lat, longitude: lng };
          driverLocationRef.current = loc;
          setDriverLocation(loc);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(locCh); };
  }, [rideId]);

  // Unread chat indicator — watch for new messages from the driver
  useEffect(() => {
    if (!rideId) return;
    const ch = supabase.channel('chat_unread_rider_' + rideId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        if (payload.new.sender_id !== myUserIdRef.current) {
          setHasUnreadChat(true);
          Vibration.vibrate([0, 80, 60, 120]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rideId]);

  // Fetch road route using OSRM
  async function fetchRoute(
    fromLat: number, fromLng: number,
    toLat: number, toLng: number
  ) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes?.[0]) {
        const coords = (data.routes[0].geometry?.coordinates || []).map((c: number[]) => ({
          latitude: c[1], longitude: c[0],
        }));
        setRouteCoords(coords);
        // ETA from OSRM (seconds → minutes)
        const secs = data.routes[0].duration;
        if (secs) setEta(Math.ceil(secs / 60));
      }
    } catch (e) { console.log('Route fetch error:', e); }
  }

  // Re-fetch route when driver moves (going_to_pickup only).
  // In_progress route is the full pickup→dropoff line — fetched once on phase change above.
  useEffect(() => {
    const dl = driverLocationRef.current;
    const r = rideRef.current;
    if (!dl || tripStatus !== 'going_to_pickup') return;
    const pLat = r?.pickup_lat ?? (paramPickupLat ? parseFloat(paramPickupLat as string) : null);
    const pLng = r?.pickup_lng ?? (paramPickupLng ? parseFloat(paramPickupLng as string) : null);
    if (!pLat || !pLng) return;
    fetchRoute(dl.latitude, dl.longitude, Number(pLat), Number(pLng));
  }, [driverLocation?.latitude, driverLocation?.longitude, ride?.pickup_lat, tripStatus]);

  // Phase-based route logic:
  //   going_to_pickup  → driver→pickup  (handled by driverLocation effect above)
  //   driver_arrived   → clear route, zoom to show driver at pickup
  //   in_progress      → fetch full pickup→dropoff route once, then live driver→dropoff
  useEffect(() => {
    if (tripStatus === 'driver_arrived') {
      setRouteCoords([]);
      // Zoom to show the driver sitting at pickup
      const dl = driverLocationRef.current;
      const pLat = rideRef.current?.pickup_lat ?? (paramPickupLat ? parseFloat(paramPickupLat as string) : null);
      const pLng = rideRef.current?.pickup_lng ?? (paramPickupLng ? parseFloat(paramPickupLng as string) : null);
      const coordsToShow: { latitude: number; longitude: number }[] = [];
      if (dl) coordsToShow.push(dl);
      if (pLat && pLng) coordsToShow.push({ latitude: Number(pLat), longitude: Number(pLng) });
      if (coordsToShow.length > 0) {
        setTimeout(() => {
          mapRef.current?.fitToCoordinates(coordsToShow, {
            edgePadding: { top: 120, right: 80, bottom: SHEET_MIN + 80, left: 80 },
            animated: true,
          });
        }, 500);
      }
    }

    if (tripStatus === 'in_progress') {
      // Fetch pickup→dropoff route whenever we enter in_progress, regardless of how we got here
      // (broadcast → handleTripStarted, or DB polling → applyRideStatus).
      // routeCoords will already be set if the broadcast path ran; this is a no-op in that case.
      const r = rideRef.current;
      const pLat = r?.pickup_lat ?? (paramPickupLat ? parseFloat(paramPickupLat as string) : null);
      const pLng = r?.pickup_lng ?? (paramPickupLng ? parseFloat(paramPickupLng as string) : null);
      const dLat = r?.dropoff_lat ?? (paramDropoffLat ? parseFloat(paramDropoffLat as string) : null);
      const dLng = r?.dropoff_lng ?? (paramDropoffLng ? parseFloat(paramDropoffLng as string) : null);
      if (pLat && pLng && dLat && dLng) {
        fetchRoute(Number(pLat), Number(pLng), Number(dLat), Number(dLng));
      }
    }
  }, [tripStatus]);

  // Heading from `from` → `to` in degrees (0 = north, clockwise)
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


  // Fit map once initially — as soon as we have rider location + either ride data or param coords.
  // After that, let the user pan freely (mapFittedRef guard).
  useEffect(() => {
    if (mapFittedRef.current) return;
    // We need at least the rider location to fit usefully
    if (!riderLocationRef.current && !driverLocationRef.current) return;
    // We need a pickup point — either from loaded ride or from URL params
    const hasPickup = !!ride?.pickup_lat || !!paramPickupLat;
    if (!hasPickup) return;
    mapFittedRef.current = true;
    setTimeout(() => fitMap(), 300); // slight delay so map is rendered
  }, [driverLocation, riderLocation, ride?.pickup_lat, paramPickupLat]);


  // Watch ride status — broadcast (primary) + postgres_changes (fallback).
  // Depends only on rideId so the channels are created ONCE and never recreated
  // mid-trip (which was causing trip_started events to be missed).
  useEffect(() => {
    if (!rideId) return;

    function handleDriverArrived() {
      setTripStatus('driver_arrived');
      sendLocalDriverArrivedNotification(driverRef.current?.full_name);
    }
    function handleTripStarted() {
      setTripStatus('in_progress');
      setRiderComing(false); // reset so stale "I'm Coming" / "Driver notified" state is cleared
      // Vibrate + notify so the rider always knows the trip has started
      Vibration.vibrate([0, 100, 80, 200, 80, 200]);
      sendLocalTripStartedNotification(driverRef.current?.full_name);
      // URL params are guaranteed in this closure (set at screen mount from navigation).
      // Fall back to rideRef if params somehow absent.
      const pLat = paramPickupLat  ? parseFloat(paramPickupLat  as string) : rideRef.current?.pickup_lat;
      const pLng = paramPickupLng  ? parseFloat(paramPickupLng  as string) : rideRef.current?.pickup_lng;
      const dLat = paramDropoffLat ? parseFloat(paramDropoffLat as string) : rideRef.current?.dropoff_lat;
      const dLng = paramDropoffLng ? parseFloat(paramDropoffLng as string) : rideRef.current?.dropoff_lng;
      if (!pLat || !pLng || !dLat || !dLng) return;
      const pickupCoord  = { latitude: Number(pLat), longitude: Number(pLng) };
      const dropoffCoord = { latitude: Number(dLat), longitude: Number(dLng) };
      // Draw the full A→B route line
      fetchRoute(pickupCoord.latitude, pickupCoord.longitude, dropoffCoord.latitude, dropoffCoord.longitude);
      // Rotate map: bearing A→B becomes "up", so pickup sits at bottom, dropoff at top
      const bearing = computeBearing(pickupCoord, dropoffCoord);
      const latDiff = dropoffCoord.latitude - pickupCoord.latitude;
      const lngDiff = dropoffCoord.longitude - pickupCoord.longitude;
      const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) || 0.01;
      // Shift center toward B to keep pickup above the bottom sheet
      const shiftFraction = SHEET_MIN / (2 * SCREEN_HEIGHT);
      const centerLat = (pickupCoord.latitude + dropoffCoord.latitude) / 2 + latDiff * shiftFraction;
      const centerLng = (pickupCoord.longitude + dropoffCoord.longitude) / 2 + lngDiff * shiftFraction;
      const zoom = Math.max(10, Math.min(Math.floor(Math.log2(712 / dist)), 16));
      setTimeout(() => {
        mapRef.current?.animateCamera({
          center: { latitude: centerLat, longitude: centerLng },
          heading: bearing,
          pitch: 0,
          zoom,
        }, { duration: 800 });
      }, 500);
    }
    function handleTripCompleted(driverId?: string) {
      setTripStatus('completed');
      // A completed ride resets the rider's cancel streak.
      if (myUserIdRef.current) resetCancelCount(myUserIdRef.current).catch(() => {});
      const id = driverId || rideRef.current?.driver_id || '';
      // Fallback DB write: the rider (passenger_id) reliably passes the rides
      // update policy, whereas the driver's write can be silently blocked by RLS.
      // This guarantees the ride leaves "active" in the admin panel.
      if (rideId) {
        supabase.from('rides').update({ status: 'completed' }).eq('id', rideId)
          .then(({ error }) => { if (error) console.log('rider complete-write error:', error.message); });
      }
      setTimeout(() => router.replace({
        pathname: '/trip-rating',
        params: { rideId, toUserId: id, toRole: 'driver' },
      } as never), 1000);
    }

    // Broadcast channel — exact same name the driver broadcasts to, never recreated.
    const broadcastCh = supabase.channel('ride_ch_' + rideId)
      .on('broadcast', { event: 'driver_arrived' }, handleDriverArrived)
      .on('broadcast', { event: 'trip_started' }, handleTripStarted)
      .on('broadcast', { event: 'trip_completed' }, () => handleTripCompleted())
      .subscribe();
    broadcastChRef.current = broadcastCh; // store so handleRiderComing can reuse it

    // DB fallback — suffixed so Supabase never returns a stale cached channel
    const dbCh = supabase.channel('ride_db_' + rideId + '_' + Date.now())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (payload) => {
        const s = payload.new.status;
        if (s === 'driver_arrived') handleDriverArrived();
        else if (s === 'in_progress') handleTripStarted();
        else if (s === 'completed') handleTripCompleted(payload.new.driver_id);
        else if (s === 'cancelled') goHome();
      })
      .subscribe();

    return () => {
      broadcastChRef.current = null;
      supabase.removeChannel(broadcastCh);
      supabase.removeChannel(dbCh);
    };
  }, [rideId]);

  function broadcastOnChannel(channelName: string, event: string, payload: Record<string, any>) {
    const ch = supabase.channel(channelName, { config: { broadcast: { ack: false } } });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event, payload });
        setTimeout(() => supabase.removeChannel(ch), 3000);
      }
    });
  }

  function handleRiderComing() {
    setRiderComing(true);
    // Send on a DEDICATED channel (ride_rider_coming_{id}) so the driver's listener matches.
    // Using broadcastChRef (ride_ch_{id}) would be on a different channel from the driver's listener.
    // Using broadcastOnChannel creates a NEW, differently-named channel — no conflict with broadcastChRef.
    broadcastOnChannel('ride_rider_coming_' + rideId, 'rider_coming', { rideId });
  }

  async function startRiderLocation() {
    // Pre-activate keep-awake so expo-location's internal call doesn't throw.
    // Use void + catch to silence both the sync throw and async rejection.
    try { await activateKeepAwakeAsync(); } catch (_) {}
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      riderLocationRef.current = coords;
      setRiderLocation(coords);
    } catch (e) { console.log('Rider location error:', e); }
  }

  function fitMap() {
    const dl = driverLocationRef.current;
    const rl = riderLocationRef.current;
    const coords: { latitude: number; longitude: number }[] = [];
    if (dl) coords.push(dl);
    if (rl) coords.push(rl);
    // Include pickup — use ride data if loaded, otherwise fall back to URL params
    const pickupLat = ride?.pickup_lat ?? (paramPickupLat ? parseFloat(paramPickupLat as string) : null);
    const pickupLng = ride?.pickup_lng ?? (paramPickupLng ? parseFloat(paramPickupLng as string) : null);
    if (pickupLat && pickupLng) coords.push({ latitude: pickupLat, longitude: pickupLng });
    if (coords.length === 0) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 100, right: 60, bottom: 380, left: 60 },
      animated: true,
    });
  }

  // ETA countdown — tick every 30s once we have a real value
  useEffect(() => {
    if (eta === null || eta <= 0) return;
    const t = setInterval(() => setEta(p => (p !== null && p > 1 ? p - 1 : p)), 30000);
    return () => clearInterval(t);
  }, [eta]);

  async function loadDriverById(id: string) {
    try {
      const { data: d } = await supabase.from('profiles').select('id, full_name, vehicle_type, phone, average_rating').eq('id', id).maybeSingle();
      if (d) {
        // Attach driver photo URL
        const photoUrl = supabase.storage.from('driver-images').getPublicUrl(`drivers/${id}.jpg`).data.publicUrl;
        const driverWithPhoto = { ...d, driver_image: photoUrl, rating: d.average_rating };
        driverRef.current = driverWithPhoto;
        setDriver(driverWithPhoto);
        if (d.vehicle_type) setDriverVehicleType(d.vehicle_type);
      }
      // Always fetch location from driver_presence — runs even if profile query failed/was blocked
      const { data: presence } = await supabase.from('driver_presence').select('latitude, longitude').eq('driver_id', id).maybeSingle();
      if (presence?.latitude && presence?.longitude) {
        const loc = { latitude: presence.latitude, longitude: presence.longitude };
        driverLocationRef.current = loc;
        setDriverLocation(loc);
      }
    } catch (e) { console.log('loadDriverById error:', e); }
  }

  function applyRideStatus(status: string, driverId?: string) {
    // Never downgrade status — broadcast may have already advanced us past what the DB shows
    // (e.g. trip_started broadcast received, then polling reads driver_arrived before the DB
    // write propagates). Only move forward in the trip lifecycle.
    const currentRank = STATUS_RANK[tripStatusRef.current] ?? 0;
    const newRank = STATUS_RANK[status] ?? 0;
    if (newRank < currentRank) return;

    if (status === 'driver_arrived') setTripStatus('driver_arrived');
    else if (status === 'in_progress') {
      setTripStatus('in_progress');
      setRiderComing(false); // clear stale "I'm Coming" state when polling picks up in_progress
    }
    else if (status === 'completed') setTripStatus('completed');
    else if (status === 'cancelled') goHome();
    if (driverId && !driverRef.current) loadDriverById(driverId);
  }

  async function loadRide() {
    if (!rideId) return;
    try {
      const { data: rideData } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
      if (rideData) {
        rideRef.current = rideData;
        setRide(rideData);
        applyRideStatus(rideData.status, rideData.driver_id);
      }
    } catch (e) {
      console.log('Load ride error:', e);
    }
  }

  // Poll every 4 seconds as a safety net in case realtime events are missed.
  useEffect(() => {
    if (!rideId) return;
    const t = setInterval(async () => {
      try {
        const { data } = await supabase.from('rides').select('status, driver_id').eq('id', rideId as string).maybeSingle();
        if (data) applyRideStatus(data.status, data.driver_id);
      } catch (_) {}
    }, 4000);
    return () => clearInterval(t);
  }, [rideId]);

  // Open the reason picker (replaces the old confirm alert). Leaving the screen
  // routes through here too, so a rider can never silently abandon a matched ride.
  function cancelRide() {
    if (tripStatus === 'completed') { router.replace('/' as never); return; }
    setShowCancelModal(true);
  }

  // Called after the rider picks a reason in CancelReasonModal.
  async function confirmCancel(reason: string) {
    setShowCancelModal(false);
    await supabase.from('rides')
      .update({ status: 'cancelled', cancel_reason: reason, cancelled_by: 'rider' })
      .eq('id', rideId);

    // Count this cancel against the rider's streak (server-side).
    let warnMsg: string | null = null;
    const uid = myUserIdRef.current;
    if (uid) {
      try {
        const res = await recordRiderCancel(uid);
        if (res.warned || res.lockedNext) {
          warnMsg = ar
            ? `لقد ألغيت كثيرًا (${res.count} مرات). لا يمكنك طلب رحلة لمدة ${CANCEL_LOCK_MINUTES} دقيقة.`
            : `You've cancelled a lot (${res.count} times). You can't request a ride for ${CANCEL_LOCK_MINUTES} minutes.`;
        }
      } catch (e) { console.log('recordRiderCancel error:', e); }
    }

    if (warnMsg) {
      Alert.alert(ar ? '⚠️ تنبيه' : '⚠️ Heads up', warnMsg, [
        { text: 'OK', onPress: () => router.replace('/' as never) },
      ]);
    } else {
      router.replace('/' as never);
    }
  }

  const driverArrived = tripStatus !== 'going_to_pickup';
  const waitMin = Math.floor(waitTime / 60);
  const waitSec = String(waitTime % 60).padStart(2, '0');

  const safetyItems = [
    { icon: '↗', label: ar ? 'مشاركة رحلتي' : 'Share my ride' },
    { icon: '🎙', label: ar ? 'تسجيل صوتي' : 'Record audio' },
    { icon: '💬', label: ar ? 'الدعم' : 'Support' },
    { icon: '👥', label: ar ? 'جهات الطوارئ' : 'Emergency contacts' },
  ];

  const protectedItems = ar
    ? [
        { icon: '🛡', label: 'دعم السلامة الاستباقي' },
        { icon: '🪪', label: 'التحقق من السائقين' },
        { icon: '🔒', label: 'حماية خصوصيتك' },
        { icon: '🏍', label: 'الأمان في كل رحلة' },
        { icon: '⚠', label: 'الحوادث: خطوات للاتباع' },
      ]
    : [
        { icon: '🛡', label: 'Proactive safety support' },
        { icon: '🪪', label: 'Drivers verification' },
        { icon: '🔒', label: 'Protecting your privacy' },
        { icon: '🏍', label: 'Staying safe on every ride' },
        { icon: '⚠', label: 'Accidents: Steps to take' },
      ];

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>

      {/* MAP — fills background */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        customMapStyle={darkMode ? darkMapStyle : undefined}
        initialRegion={{
          latitude: paramPickupLat ? parseFloat(paramPickupLat as string) : (riderLocation?.latitude ?? 33.8938),
          longitude: paramPickupLng ? parseFloat(paramPickupLng as string) : (riderLocation?.longitude ?? 35.5018),
          latitudeDelta: 0.02, longitudeDelta: 0.02,
        }}
        showsUserLocation
      >
        {/* Driver live location */}
        {driverLocation && (
          <Marker
            key={`driver-${driverVehicleType || 'unknown'}`}
            coordinate={driverLocation}
            anchor={{ x: 0.5, y: 0.5 }}
            title={driver?.full_name || 'Driver'}
          >
            <View style={styles.driverMarker}>
              <Text style={{ fontSize: 18 }}>
                {driverVehicleType === 'Tuktuk' ? '🛺' : driverVehicleType === 'Car' ? '🚗' : '🏍'}
              </Text>
            </View>
          </Marker>
        )}

        {/* Pickup marker (A) — ride data first, URL params as fallback */}
        {(ride?.pickup_lat || paramPickupLat) && tripStatus !== 'completed' && (
          <Marker coordinate={{
            latitude: Number(ride?.pickup_lat ?? parseFloat(paramPickupLat as string)),
            longitude: Number(ride?.pickup_lng ?? parseFloat(paramPickupLng as string)),
          }}>
            <View style={styles.pickupMarker}>
              <Text style={styles.markerLabel}>A</Text>
            </View>
          </Marker>
        )}

        {/* Dropoff marker (B) — ride data first, URL params as fallback */}
        {(ride?.dropoff_lat || paramDropoffLat) && (
          <Marker coordinate={{
            latitude: Number(ride?.dropoff_lat ?? parseFloat(paramDropoffLat as string)),
            longitude: Number(ride?.dropoff_lng ?? parseFloat(paramDropoffLng as string)),
          }}>
            <View style={styles.dropoffMarker}>
              <Text style={styles.markerLabel}>B</Text>
            </View>
          </Marker>
        )}

        {/* Route line — driver→pickup (arriving) or pickup→dropoff (in progress) */}
        {routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#F4B400"
            strokeWidth={4}
            lineDashPattern={tripStatus === 'going_to_pickup' ? [1] : undefined}
          />
        )}
      </MapView>

      {/* STATUS BANNER at top */}
      <View style={[styles.statusBanner, { backgroundColor: cardBg }]}>
        <Text style={[styles.statusBannerText, { color: textColor }]}>
          {tripStatus === 'going_to_pickup'
            ? (ar ? `${driverVehicleType === 'Tuktuk' ? '🛺' : driverVehicleType === 'Car' ? '🚗' : '🏍'} السائق في الطريق` : `${driverVehicleType === 'Tuktuk' ? '🛺' : driverVehicleType === 'Car' ? '🚗' : '🏍'} Driver on the way`)
            : tripStatus === 'driver_arrived'
            ? (ar ? '📍 السائق وصل إليك!' : '📍 Driver has arrived!')
            : tripStatus === 'in_progress'
            ? (ar ? '🏁 الرحلة جارية' : '🏁 Trip in progress')
            : (ar ? '✅ اكتملت الرحلة' : '✅ Trip completed')}
        </Text>
        {eta !== null && (
          <Text style={styles.statusBannerEta}>
            {tripStatus === 'in_progress'
              ? (ar ? `الوصول للوجهة خلال ~${eta} دقيقة` : `To destination in ~${eta} min`)
              : tripStatus === 'going_to_pickup'
              ? (ar ? `الوصول إليك خلال ~${eta} دقيقة` : `Arriving in ~${eta} min`)
              : ''}
          </Text>
        )}
      </View>

      {/* NAVIGATE BUTTON */}
      {(tripStatus === 'going_to_pickup' || tripStatus === 'in_progress') && ride && (
        <Pressable
          style={[styles.navBtn, { backgroundColor: cardBg, borderColor }]}
          onPress={() => {
            const targetLat = tripStatus === 'in_progress' ? ride.dropoff_lat : ride.pickup_lat;
            const targetLng = tripStatus === 'in_progress' ? ride.dropoff_lng : ride.pickup_lng;
            Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`);
          }}
        >
          <Text style={[styles.navBtnText, { color: textColor }]}>🧭 {ar ? 'فتح الخريطة' : 'Navigate'}</Text>
        </Pressable>
      )}

      {/* DRAGGABLE BOTTOM SHEET */}
      <Animated.View style={[styles.sheet, { top: sheetY, backgroundColor: cardBg }]}>

        {/* DRAG HANDLE */}
        <Pressable onPress={toggleSheet} {...panResponder.panHandlers}>
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
        </Pressable>

        <ScrollView
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >

          {/* ETA / ARRIVED HEADER */}
          <View style={styles.etaBlock}>
            <View style={{ flex: 1 }}>
              {tripStatus === 'going_to_pickup' && (
                <>
                  <Text style={[styles.etaTitle, { color: textColor }]}>
                    {eta ? (ar ? `السائق يصل خلال ~${eta} دقيقة` : `Driver arriving in ~${eta} min`)
                         : (ar ? 'السائق في الطريق...' : 'Driver on the way...')}
                  </Text>
                  <Text style={styles.etaSub}>
                    {driverVehicleType || (ar ? 'دراجة نارية' : 'Motorcycle')} · {driver?.full_name || (ar ? 'سائقك' : 'Your driver')}
                  </Text>
                </>
              )}
              {tripStatus === 'driver_arrived' && (
                <>
                  <Text style={[styles.etaTitle, { color: textColor }]}>{ar ? '📍 السائق وصل!' : '📍 Driver has arrived!'}</Text>
                  <Text style={styles.etaSub}>{ar ? 'السائق ينتظرك عند نقطة الاستلام' : 'Driver is waiting at pickup'}</Text>
                  {!riderComing ? (
                    <Pressable style={styles.imComingBtn} onPress={handleRiderComing}>
                      <Text style={styles.imComingText}>{ar ? '🚶 أنا قادم!' : '🚶 I\'m Coming!'}</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.comingConfirmed}>
                      <Text style={styles.comingConfirmedText}>{ar ? '✅ أخبرنا السائق أنك قادم' : '✅ Driver notified you\'re on the way'}</Text>
                    </View>
                  )}
                </>
              )}
              {tripStatus === 'in_progress' && (
                <>
                  <Text style={[styles.etaTitle, { color: textColor }]}>{ar ? '🏁 الرحلة جارية' : '🏁 Trip in progress'}</Text>
                  <Text style={styles.etaSub}>
                    {driverVehicleType || (ar ? 'دراجة نارية' : 'Motorcycle')} · {driver?.full_name || (ar ? 'سائقك' : 'Your driver')}
                  </Text>
                </>
              )}
              {tripStatus === 'completed' && (
                <>
                  <Text style={[styles.etaTitle, { color: textColor }]}>{ar ? '✅ اكتملت الرحلة' : '✅ Trip completed'}</Text>
                  <Text style={styles.etaSub}>{ar ? 'جارٍ الانتقال للتقييم...' : 'Going to rating...'}</Text>
                </>
              )}
              {/* PLATE */}
              <View style={[styles.plateBadge, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
                <Text style={[styles.plateText, { color: textColor }]}>{ride?.plate || 'M000000'}</Text>
              </View>
            </View>
            {/* Driver photo — always visible, tap opens profile */}
            <Pressable
              onPress={() => { const dId = driver?.id; if (dId) router.push({ pathname: '/driver-profile/[id]', params: { id: dId } } as never); }}
              style={{ alignItems: 'center', gap: 4 }}
            >
              <View style={styles.driverAvatarWrap}>
                {driver?.driver_image && !driverImageError ? (
                  <Image
                    source={{ uri: driver.driver_image }}
                    style={styles.driverAvatar}
                    onError={() => setDriverImageError(true)}
                  />
                ) : (
                  <View style={[styles.driverAvatar, styles.driverAvatarFallback]}>
                    <Text style={styles.driverAvatarText}>
                      {driver?.full_name?.[0]?.toUpperCase() || (driverVehicleType === 'Tuktuk' ? '🛺' : driverVehicleType === 'Car' ? '🚗' : '🏍')}
                    </Text>
                  </View>
                )}
                {driver?.rating != null && (
                  <View style={styles.ratingBadge}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>⭐ {Number(driver.rating).toFixed(1)}</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: '#F4B400', fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
                {ar ? 'الملف' : 'Profile'}
              </Text>
            </Pressable>
          </View>

          {/* ─── EXPANDED CONTENT ─── */}

          {/* DRIVER ROW — profile / chat / call / safety */}
          <View style={[styles.driverRow, { borderBottomColor: borderColor }]}>

            {/* Chat */}
            <Pressable onPress={() => {
              setHasUnreadChat(false);
              router.push({
                pathname: '/chat' as never,
                params: {
                  rideId: rideId,
                  otherUserId: driver?.id,
                  otherName: driver?.full_name,
                  otherImage: driver?.driver_image || '',
                  otherPhone: driver?.phone || '',
                  role: 'driver',
                },
              } as never);
            }}>
              <View style={{ position: 'relative' }}>
                <View style={[styles.actionCircle, { backgroundColor: darkMode ? '#374151' : '#E5E7EB' }]}>
                  <Text style={{ fontSize: 22 }}>💬</Text>
                </View>
                {hasUnreadChat && (
                  <View style={[styles.unreadDot, { borderColor: cardBg }]} />
                )}
              </View>
              <Text style={styles.actionLabel}>{ar ? 'دردشة' : 'Chat'}</Text>
            </Pressable>

            {/* Call */}
            <Pressable onPress={() => {
              // Place a real phone call when we have the driver's number
              // (the in-app voice engine only works in native builds, not Expo Go).
              const phone = (driver?.phone || '').replace(/\s/g, '');
              if (phone) {
                Linking.openURL(`tel:${phone}`).catch(() => callModalRef.current?.startCall());
              } else {
                callModalRef.current?.startCall();
              }
            }}>
              <View style={[styles.actionCircle, { backgroundColor: '#16A34A' }]}>
                <Text style={{ fontSize: 22 }}>📞</Text>
              </View>
              <Text style={styles.actionLabel}>{ar ? 'اتصال' : 'Call'}</Text>
            </Pressable>

            {/* Safety */}
            <Pressable onPress={() => setShowSafety(true)}>
              <View style={[styles.actionCircle, { backgroundColor: '#16A34A' }]}>
                <Text style={{ fontSize: 22 }}>🛡️</Text>
              </View>
              <Text style={styles.actionLabel}>{ar ? 'الأمان' : 'Safety'}</Text>
            </Pressable>
          </View>

          {/* NOTE INPUT */}
          <View style={[styles.noteRow, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={{ fontSize: 18 }}>💬</Text>
            <Text style={styles.noteText}>{ride?.note || (ar ? 'أي ملاحظات للسائق؟' : 'Any pickup notes for driver?')}</Text>
            <Text style={styles.noteArrow}>›</Text>
          </View>

          {/* PAYMENT */}
          <View style={[styles.infoCard, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={styles.infoLabel}>{ar ? 'الدفع' : 'Payment'}</Text>
            <Text style={[styles.infoValue, { color: textColor }]}>💵 {ride?.price?.toLocaleString() || '100,000'} {ar ? 'ل.ل' : 'L.L'} · {ar ? 'نقداً' : 'Cash'}</Text>
          </View>

          {/* ROUTE */}
          <View style={[styles.infoCard, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={styles.infoLabel}>{ar ? 'رحلتك الحالية' : 'Your current ride'}</Text>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#16A34A' }]} />
              <Text style={[styles.routeText, { color: textColor }]}>{ar ? 'نقطة الاستلام' : 'Pickup location'}</Text>
            </View>
            <View style={[styles.routeLine]} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#EF4444' }]} />
              <Text style={[styles.routeText, { color: textColor }]}>{ar ? 'الوجهة' : 'Destination'}</Text>
            </View>
          </View>

          {/* SHARE */}
          <Pressable style={styles.actionRow}>
            <Text style={styles.actionRowIcon}>↗️</Text>
            <Text style={[styles.actionRowText, { color: textColor }]}>{ar ? 'مشاركة رحلتي' : 'Share my ride'}</Text>
            <Text style={styles.actionRowArrow}>›</Text>
          </Pressable>

          {/* CALL 112 */}
          <Pressable style={styles.actionRow} onPress={() => Linking.openURL('tel:112')}>
            <Text style={styles.actionRowIcon}>🚨</Text>
            <Text style={[styles.actionRowText, { color: '#EF4444' }]}>{ar ? 'اتصل بـ 112' : 'Call 112'}</Text>
            <Text style={[styles.actionRowArrow, { color: '#EF4444' }]}>›</Text>
          </Pressable>

          {/* CANCEL */}
          <Pressable style={styles.cancelBtn} onPress={cancelRide}>
            <Text style={styles.cancelText}>{ar ? 'إلغاء الرحلة' : 'Cancel the ride'}</Text>
          </Pressable>

        </ScrollView>
      </Animated.View>

      {/* ── IN-APP CALL ── */}
      {myUserId && driver?.id && rideId && (
        <CallModal
          ref={callModalRef}
          rideId={rideId as string}
          myId={myUserId}
          myName=""
          otherUserId={driver.id}
          otherName={driver.full_name || (ar ? 'السائق' : 'Driver')}
          locale={locale}
          darkMode={darkMode}
        />
      )}

      {/* ── CANCEL REASON ── */}
      <CancelReasonModal
        visible={showCancelModal}
        role="rider"
        ar={ar}
        darkMode={darkMode}
        onClose={() => setShowCancelModal(false)}
        onConfirm={confirmCancel}
      />

      {/* ── SAFETY MODAL ── */}
      <Modal visible={showSafety} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>

            {/* Handle */}
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>{ar ? 'ميزات الأمان' : 'Safety features'}</Text>
              <Pressable onPress={() => setShowSafety(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>

            {/* 2x2 safety grid */}
            <View style={styles.safetyGrid}>
              {safetyItems.map((item) => (
                <Pressable key={item.label} style={styles.safetyItem}>
                  <Text style={styles.safetyIcon}>{item.icon}</Text>
                  <Text style={styles.safetyLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Call 112 */}
            <Pressable style={styles.call112} onPress={() => Linking.openURL('tel:112')}>
              <Text style={styles.call112Text}>🚨 {ar ? 'اتصل بـ 112' : 'Call 112'}</Text>
            </Pressable>

            {/* Protected section */}
            <Text style={[styles.protectedTitle, { color: textColor }]}>{ar ? 'كيف نحميك' : "How you're protected"}</Text>
            <View style={styles.protectedGrid}>
              {protectedItems.map((item) => (
                <View key={item.label} style={[styles.protectedItem, { backgroundColor: darkMode ? '#374151' : '#F3F4F6' }]}>
                  <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                  <Text style={[styles.protectedLabel, { color: textColor }]}>{item.label}</Text>
                </View>
              ))}
            </View>

          </View>
        </View>
      </Modal>

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
  pickupMarker: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  dropoffMarker: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  markerLabel: { color: '#fff', fontSize: 11, fontWeight: '900' },

  // Status banner
  statusBanner: { position: 'absolute', top: 56, left: 16, right: 16, backgroundColor: '#1F2937', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  statusBannerText: { color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  statusBannerEta: { color: '#F4B400', fontWeight: '700', fontSize: 13, textAlign: 'center' },

  // Sheet
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#111827', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handleArea: { alignItems: 'center', paddingVertical: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#374151' },

  // ETA block
  etaBlock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  etaTitle: { fontSize: 17, fontWeight: '900', color: '#fff', marginBottom: 4 },
  etaSub: { fontSize: 13, color: '#9CA3AF', marginBottom: 8 },
  plateBadge: { backgroundColor: '#1F2937', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  plateText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },

  // Driver row
  driverRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1F2937', marginBottom: 14 },
  driverAvatarWrap: { position: 'relative', alignItems: 'center' },
  driverAvatar: { width: 60, height: 60, borderRadius: 30 },
  driverAvatarFallback: { backgroundColor: '#F4B400', alignItems: 'center', justifyContent: 'center' },
  driverAvatarText: { fontSize: 24, fontWeight: '900', color: '#111827' },
  ratingBadge: { position: 'absolute', bottom: -4, right: -4, backgroundColor: '#F4B400', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 2 },
  driverLabel: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center', marginTop: 6 },
  actionCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: '#9CA3AF', fontWeight: '600', fontSize: 11, textAlign: 'center', marginTop: 6, maxWidth: 70 },
  unreadDot: { position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#EF4444', borderWidth: 2 },

  // Note row
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1F2937', borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 12 },
  noteText: { flex: 1, color: '#9CA3AF', fontSize: 14 },
  noteArrow: { color: '#6B7280', fontSize: 20 },

  // Info card
  infoCard: { backgroundColor: '#1F2937', borderRadius: 14, padding: 14, marginHorizontal: 20, marginBottom: 10, gap: 8 },
  infoLabel: { fontSize: 12, color: '#6B7280', fontWeight: '700' },
  infoValue: { fontSize: 15, color: '#fff', fontWeight: '600' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeLine: { width: 2, height: 12, backgroundColor: '#374151', marginLeft: 5, marginVertical: 2 },
  routeText: { fontSize: 14, color: '#D1D5DB', fontWeight: '600' },

  // Action rows
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  actionRowIcon: { fontSize: 20 },
  actionRowText: { flex: 1, fontSize: 15, color: '#fff', fontWeight: '600' },
  actionRowArrow: { fontSize: 20, color: '#6B7280' },

  // Cancel
  cancelBtn: { marginHorizontal: 20, marginTop: 16, borderWidth: 1, borderColor: '#374151', borderRadius: 16, padding: 18, alignItems: 'center' },
  cancelText: { fontSize: 16, color: '#EF4444', fontWeight: '700' },

  // Safety modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#1F2937', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#374151', alignSelf: 'center', marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  modalCloseBtn: { backgroundColor: '#374151', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalClose: { fontSize: 16, color: '#9CA3AF', fontWeight: '700' },
  safetyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  safetyItem: { width: '47%', backgroundColor: '#374151', borderRadius: 16, padding: 20, alignItems: 'center', gap: 10 },
  safetyIcon: { fontSize: 30 },
  safetyLabel: { fontSize: 13, color: '#fff', fontWeight: '700', textAlign: 'center' },
  call112: { backgroundColor: '#EF4444', borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 24 },
  call112Text: { fontSize: 17, fontWeight: '900', color: '#fff' },
  protectedTitle: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 14 },
  protectedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  protectedItem: { width: '47%', backgroundColor: '#374151', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  protectedLabel: { fontSize: 13, color: '#D1D5DB', fontWeight: '600', flex: 1 },

  navBtn: { position: 'absolute', bottom: SHEET_MIN + 12, alignSelf: 'center', backgroundColor: '#1F2937', borderRadius: 24, paddingVertical: 10, paddingHorizontal: 24, borderWidth: 1, borderColor: '#374151' },
  navBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  imComingBtn: { backgroundColor: '#F4B400', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'flex-start', marginTop: 10 },
  imComingText: { color: '#111827', fontWeight: '900', fontSize: 15 },
  comingConfirmed: { backgroundColor: '#14532D', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 10 },
  comingConfirmedText: { color: '#86EFAC', fontWeight: '700', fontSize: 13 },
});
