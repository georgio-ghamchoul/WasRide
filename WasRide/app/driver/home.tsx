import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { activateKeepAwakeAsync } from "expo-keep-awake";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { View, Text, StyleSheet, Pressable, Animated, Modal, Alert, ActivityIndicator, Dimensions, AppState } from "react-native";
import { useAppState } from "@/lib/app-state";
import NotificationBell from "@/components/NotificationBell";

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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

export default function DriverHomeScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams();
  const { locale, setLocale, darkMode, setDarkMode } = useAppState();
  const ar = locale === 'ar';

  const cardBg = darkMode ? '#1F2937' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const sectionLabelColor = darkMode ? '#6B7280' : '#9CA3AF';
  const dividerColor = darkMode ? '#374151' : '#F3F4F6';
  const itemBg = darkMode ? '#374151' : '#F9FAFB';

  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [driverData, setDriverData] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState<any>(null);
  const [accepting, setAccepting] = useState(false);
  const [offerPrice, setOfferPrice] = useState(0);
  const [riderPrice, setRiderPrice] = useState(0); // the original price the rider set — never changes
  const [requestRouteCoords, setRequestRouteCoords] = useState<any[]>([]);
  const [pendingRideId, setPendingRideId] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [requestTimer, setRequestTimer] = useState(15);
  const [tripInfo, setTripInfo] = useState<{
    distanceKm: number | null;
    etaMin: number | null;
    dropoffZone: string;
    pickupLabel: string;
  } | null>(null);

  const vehicleEmoji = driverData?.vehicle_type === 'Tuktuk' ? '🛺' : driverData?.vehicle_type === 'Car' ? '🚗' : '🏍';

  const locationSub = useRef<any>(null);
  const driverDataRef = useRef<any>(null);
  // Tracks the latest online state for async location callbacks, so a queued
  // GPS tick can't re-write is_online:true after the driver has gone offline.
  const onlineRef = useRef(false);
  const locationRef = useRef<any>(null); // always-fresh location for async callbacks
  const hasRequestRef = useRef(false); // true while a ride request card is visible — suppresses map re-centering on driver
  const pendingRideDataRef = useRef<any>(null); // saves ride coords when counter-offer is sent (incomingRequest cleared before useEffect runs)
  const scale1 = useRef(new Animated.Value(1)).current;
  const scale2 = useRef(new Animated.Value(1)).current;
  const scale3 = useRef(new Animated.Value(1)).current;
  const opacity1 = useRef(new Animated.Value(0.8)).current;
  const opacity2 = useRef(new Animated.Value(0.5)).current;
  const opacity3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => { locationRef.current = location; }, [location]);

  useEffect(() => {
    loadDriverData();
    initLocation();
  }, []);

  // Real-time ban detection — if admin bans this driver while they're in the app,
  // immediately force them offline and show an alert.
  useEffect(() => {
    if (!driverData?.id) return;
    const driverId = driverData.id;
    const channelName = 'ban_watcher_' + driverId;

    // Remove any stale channel with this name before subscribing —
    // calling .on() on an already-subscribed channel throws an error.
    const stale = supabase.getChannels().find((c: any) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const banWatcher = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${driverId}`,
      }, async (payload) => {
        const newStatus = payload.new?.approval_status;
        const banMsg = payload.new?.ban_message;
        if (newStatus === 'rejected' || newStatus === 'suspended') {
          // Update local cache so toggleOnline check is also correct
          setDriverData((prev: any) => prev ? { ...prev, approval_status: newStatus, ban_message: banMsg } : prev);
          driverDataRef.current = { ...driverDataRef.current, approval_status: newStatus, ban_message: banMsg };
          // Force offline
          setIsOnline(false);
          await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', driverId);
          Alert.alert(
            ar ? 'تم حظر حسابك' : 'Account Banned',
            banMsg && String(banMsg).trim()
              ? String(banMsg)
              : (ar ? 'تم حظر حسابك من قِبَل الإدارة. تواصل مع الدعم.' : 'Your account has been banned by admin. Please contact support.')
          );
        } else if (newStatus === 'approved') {
          setDriverData((prev: any) => prev ? { ...prev, approval_status: 'approved', ban_message: null } : prev);
          driverDataRef.current = { ...driverDataRef.current, approval_status: 'approved', ban_message: null };
        }
      })
      .subscribe();

    return () => {
      const ch = supabase.getChannels().find((c: any) => c.topic === `realtime:${channelName}`);
      if (ch) supabase.removeChannel(ch);
    };
  }, [driverData?.id]);

  useEffect(() => {
    onlineRef.current = isOnline;
    if (!isOnline) {
      locationSub.current?.remove();
      locationSub.current = null;
      return;
    }
    startLiveTracking();
    startPulseAnimation();
  }, [isOnline]);

  // ── Go offline when app is backgrounded or closed ────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        const driverId = driverDataRef.current?.id;
        if (driverId) {
          onlineRef.current = false;
          locationSub.current?.remove();
          locationSub.current = null;
          await supabase.from('driver_presence')
            .update({ is_online: false })
            .eq('driver_id', driverId);
          setIsOnline(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Auto go-online when returning from a completed or cancelled trip
  useEffect(() => {
    if (params.autoOnline === 'true' && driverData) {
      toggleOnline();
    }
  }, [driverData?.id]);

  // Watch for rider accepting counter offer via Broadcast channel (bypasses RLS entirely)
  useEffect(() => {
    if (!pendingRideId) return;
    const capturedRideId = pendingRideId;
    let navigated = false;

    // Use ref — incomingRequest is null by the time this effect runs (React 18 batching)
    const capturedRide = pendingRideDataRef.current;

    async function goToTrip() {
      if (navigated) return;
      navigated = true;
      await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', driverDataRef.current?.id);
      setPendingRideId(null);
      setPendingRequestId(null);
      setTripInfo(null);
      router.push({
        pathname: '/driver/trip',
        params: {
          rideId: capturedRideId,
          pickupLat: capturedRide?.pickup_lat,
          pickupLng: capturedRide?.pickup_lng,
          dropoffLat: capturedRide?.dropoff_lat,
          dropoffLng: capturedRide?.dropoff_lng,
        },
      } as never);
    }

    // Broadcast channel — no RLS, instant delivery.
    // Reuse existing channel if handleCounterOffer already created it (avoids duplicate subscribe).
    const rideChTopic = `realtime:ride_ch_${capturedRideId}`;
    const existingCh = supabase.getChannels().find((c: any) => c.topic === rideChTopic);
    const ch = existingCh ?? supabase.channel('ride_ch_' + capturedRideId);
    ch.on('broadcast', { event: 'rider_accepted' }, () => {
      console.log('✅ Broadcast: rider accepted!');
      goToTrip();
    });
    ch.on('broadcast', { event: 'rider_declined' }, () => {
      console.log('❌ Broadcast: rider declined');
      setPendingRideId(null);
      setPendingRequestId(null);
    });
    if (!existingCh) {
      ch.subscribe((status) => console.log('📡 Driver ride_ch status:', status));
    }

    // Fallback poll every 2s in case broadcast is missed.
    // IMPORTANT: always check ride status directly — pendingRequestId may be null
    // when the request arrived via broadcast (incomingRequest.id = null in that path).
    const poll = setInterval(async () => {
      const driverId = driverDataRef.current?.id;
      if (!driverId) return;

      // Primary check: ride status (rider sets this when they accept)
      const { data: ride } = await supabase
        .from('rides').select('status, driver_id').eq('id', capturedRideId).maybeSingle();
      if (ride?.status === 'accepted' && (ride.driver_id === driverId || !ride.driver_id)) {
        clearInterval(poll);
        goToTrip();
        return;
      }

      // Secondary check: ride_request status (when we have the request id)
      if (pendingRequestId) {
        const { data: req } = await supabase
          .from('ride_requests').select('id, status')
          .eq('id', pendingRequestId).maybeSingle();
        if (req?.status === 'accepted') { clearInterval(poll); goToTrip(); return; }
        if (req?.status === 'ignored' || req?.status === 'cancelled') {
          clearInterval(poll);
          setPendingRideId(null);
          setPendingRequestId(null);
          return;
        }
      } else {
        // No request id yet — try to find it from DB so future checks can use it
        const { data: req } = await supabase
          .from('ride_requests').select('id, status')
          .eq('ride_id', capturedRideId).eq('driver_id', driverId).maybeSingle();
        if (req?.id) setPendingRequestId(req.id);
        if (req?.status === 'accepted') { clearInterval(poll); goToTrip(); }
        else if (req?.status === 'ignored' || req?.status === 'cancelled') {
          clearInterval(poll);
          setPendingRideId(null);
          setPendingRequestId(null);
        }
      }
    }, 2000);

    return () => {
      clearInterval(poll);
      // Remove by topic so we always get the current channel object, even if it was replaced
      const deadCh = supabase.getChannels().find((c: any) => c.topic === rideChTopic);
      if (deadCh) supabase.removeChannel(deadCh);
    };
  }, [pendingRideId]);

  // Keep hasRequestRef in sync so GPS updates don't re-center the map while card is showing
  useEffect(() => {
    hasRequestRef.current = !!incomingRequest;
    if (!incomingRequest) setRequestRouteCoords([]);
  }, [!!incomingRequest]);

  // Fit main map to pickup→dropoff whenever both coords are available.
  // Re-runs each time dropoff coords change (broadcast arrives in two waves).
  useEffect(() => {
    const ride = incomingRequest?.ride;
    if (ride?.pickup_lat == null || ride?.pickup_lng == null) return;
    const coords: { latitude: number; longitude: number }[] = [
      { latitude: Number(ride.pickup_lat), longitude: Number(ride.pickup_lng) },
    ];
    if (ride.dropoff_lat != null && ride.dropoff_lng != null) {
      coords.push({ latitude: Number(ride.dropoff_lat), longitude: Number(ride.dropoff_lng) });
    }
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: 380, left: 40 }, animated: true,
      });
    }, 400);
  }, [
    incomingRequest?.ride?.pickup_lat,
    incomingRequest?.ride?.pickup_lng,
    incomingRequest?.ride?.dropoff_lat,
    incomingRequest?.ride?.dropoff_lng,
  ]);

  // 15-second countdown — auto-ignore when it hits 0
  useEffect(() => {
    if (!incomingRequest) return;
    setRequestTimer(15);
    const interval = setInterval(() => {
      setRequestTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleIgnore();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [incomingRequest?.id]);

  // Listen for incoming ride requests
  useEffect(() => {
    if (!driverData) return;

    // Helper: apply ride data to the request card
    function applyRideData(req: any, ride: any) {
      setIncomingRequest({ ...req, ride });
      if (ride?.pickup_lat) {
        // Show a clean loading placeholder while Nominatim reverse-geocodes
        setTripInfo({
          distanceKm: null, etaMin: null,
          pickupLabel: 'Loading location...',
          dropoffZone: 'Loading area...',
        });
        fetchRequestRoute(ride.pickup_lng, ride.pickup_lat, ride.dropoff_lng, ride.dropoff_lat);
        fetchTripInfo(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng);
      } else {
        setTripInfo(null);
      }
      // Use rider's exact price. If DB returns null (RLS blocked read), broadcast will fix it.
      const price = Number(ride?.price) || 100000;
      setRiderPrice(price);
      setOfferPrice(price);
    }

    // Use a unique suffix for postgres_changes channel to avoid re-mount conflicts.
    // The BROADCAST channel MUST use the exact name the rider sends to — no suffix!
    const suffix = Date.now();

    // Primary: broadcast channel carries full ride data (bypasses RLS entirely)
    // IMPORTANT: channel name must match exactly what waiting.tsx broadcasts to.
    const broadcastChannelName = 'driver_ride_data_' + driverData.id;
    // Remove any stale channel with this name before creating a fresh one
    const staleChannel = supabase.getChannels().find((ch: any) => ch.topic === `realtime:${broadcastChannelName}`);
    if (staleChannel) supabase.removeChannel(staleChannel);

    const broadcastCh = supabase
      .channel(broadcastChannelName)
      .on('broadcast', { event: 'new_ride_data' }, (msg) => {
        console.log('📢 Broadcast ride data:', msg.payload);
        const p = msg.payload;
        const ride = {
          pickup_lat: p.pickup_lat, pickup_lng: p.pickup_lng,
          dropoff_lat: p.dropoff_lat, dropoff_lng: p.dropoff_lng,
          price: p.price, note: p.note, service: p.service,
        };
        // Build a minimal req object; real req will arrive via postgres_changes shortly after
        const req = { ride_id: p.rideId, id: null };
        applyRideData(req, ride);
      })
      .subscribe();

    // Fallback: postgres_changes catches the INSERT and fetches ride data from DB
    // (works if RLS is fixed, or on Android where the broadcast may be slightly delayed)
    const pgCh = supabase
      .channel('driver_requests_' + driverData.id + '_' + suffix)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ride_requests',
        filter: `driver_id=eq.${driverData.id}`
      }, async (payload) => {
        console.log('🚨 postgres_changes ride request:', JSON.stringify(payload.new));
        const req = payload.new;
        const { data: ride } = await supabase.from('rides').select('*').eq('id', req.ride_id).maybeSingle();
        // ride may be null if RLS blocks read — broadcast already populated the card in that case
        if (ride) {
          applyRideData(req, ride);
        } else {
          // RLS blocked the read — update the req id so accept/counter work correctly
          setIncomingRequest((prev: any) => prev ? { ...prev, id: req.id, ride_id: req.ride_id } : prev);
        }
      })
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status, '| Driver ID:', driverData.id);
      });

    // ── Polling fallback ──────────────────────────────────────────────────────
    // Broadcast and postgres_changes can silently fail (RLS, Realtime not enabled,
    // WebSocket drops). Poll ride_requests every 5 s so the driver never misses a job.
    const seenRequestIds = new Set<string>();
    const poll = setInterval(async () => {
      if (!driverDataRef.current) return;
      // Already showing a request or waiting for rider — don't interrupt
      if (hasRequestRef.current) return;

      const { data: reqs } = await supabase
        .from('ride_requests')
        .select('id, ride_id, status')
        .eq('driver_id', driverDataRef.current.id)
        .eq('status', 'pending')
        .limit(1);

      if (!reqs?.length) return;
      const req = reqs[0];
      if (seenRequestIds.has(req.id)) return; // already handled this one
      seenRequestIds.add(req.id);

      console.log('🔄 Poll found pending ride_request:', req.id);
      const { data: ride } = await supabase.from('rides').select('*').eq('id', req.ride_id).maybeSingle();
      if (ride) {
        applyRideData(req, ride);
      } else {
        // RLS blocks ride read — show minimal card so driver can still respond
        applyRideData(req, { pickup_lat: null, pickup_lng: null, dropoff_lat: null, dropoff_lng: null, price: null });
      }
    }, 5000);

    return () => {
      supabase.removeChannel(broadcastCh);
      supabase.removeChannel(pgCh);
      clearInterval(poll);
    };
  }, [driverData]);


  // Helper: send a broadcast event on a channel.
  // Reuses an existing subscription if one exists for that channel name,
  // because calling .subscribe() on an already-subscribed channel is a no-op
  // and .send() would never fire inside the callback.
  function broadcastOnChannel(channelName: string, event: string, payload: Record<string, any>) {
    const topic = `realtime:${channelName}`;
    const existing = supabase.getChannels().find((c: any) => c.topic === topic);
    if (existing) {
      existing.send({ type: 'broadcast', event, payload });
      return;
    }
    // No existing channel — create one, subscribe, send, then clean up
    const ch = supabase.channel(channelName, { config: { broadcast: { ack: false } } });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event, payload });
        setTimeout(() => supabase.removeChannel(ch), 3000);
      }
    });
  }

  async function handleAccept() {
    if (!incomingRequest) return;
    setAccepting(true);
    const rideId = incomingRequest.ride_id;
    const driverId = driverDataRef.current?.id;

    // Update ride_requests (driver always owns these rows — no RLS issue)
    await supabase.from('ride_requests').update({ status: 'accepted' }).eq('id', incomingRequest.id);
    await supabase.from('ride_requests')
      .update({ status: 'cancelled' })
      .eq('ride_id', rideId)
      .neq('id', incomingRequest.id)
      .eq('status', 'pending');

    // Try rides update — may succeed or fail silently depending on RLS
    // Rider's broadcast handler will do it as fallback if this fails
    await supabase.from('rides').update({ status: 'accepted', driver_id: driverId }).eq('id', rideId);

    // Broadcast to rider (bypasses RLS — always works)
    broadcastOnChannel('ride_ch_' + rideId, 'driver_accepted', { driverId, rideId });

    await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', driverId);
    const ride = incomingRequest.ride;
    setIncomingRequest(null);
    setTripInfo(null);
    setAccepting(false);
    router.push({
      pathname: '/driver/trip',
      params: {
        rideId,
        pickupLat: ride?.pickup_lat,
        pickupLng: ride?.pickup_lng,
        dropoffLat: ride?.dropoff_lat,
        dropoffLng: ride?.dropoff_lng,
      },
    } as never);
  }

  async function handleCounterOffer() {
    if (!incomingRequest) return;
    setAccepting(true);
    const rideId = incomingRequest.ride_id;
    const driverId = driverDataRef.current?.id;
    const requestId = incomingRequest.id;

    // Enforce max 2 counter-offers
    const { data: prevOffers } = await supabase.from('ride_requests')
      .select('id').eq('ride_id', rideId).eq('status', 'counter_offer');
    if ((prevOffers?.length || 0) >= 2) {
      Alert.alert(
        ar ? 'تجاوزت الحد' : 'Limit reached',
        ar ? 'يمكنك تغيير السعر مرتين فقط لكل رحلة' : 'You can only counter-offer twice per ride'
      );
      setAccepting(false);
      return;
    }

    // Update ride_requests status (driver owns — always works)
    await supabase.from('ride_requests').update({ status: 'counter_offer' }).eq('id', requestId);

    // Try rides update (might fail if RLS blocks driver — broadcast is the reliable path)
    await supabase.from('rides').update({
      price: offerPrice, status: 'counter_offer', driver_id: driverId,
    }).eq('id', rideId);

    // Broadcast price + driverId directly to rider — bypasses RLS, always delivers.
    // IMPORTANT: do NOT use broadcastOnChannel() here — it removes the channel after 3s,
    // which destroys the very channel the pendingRideId useEffect listens on for rider_accepted.
    // Instead keep the channel alive; the pendingRideId cleanup will remove it.
    const rideChTopic = `realtime:ride_ch_${rideId}`;
    const existingRideCh = supabase.getChannels().find((c: any) => c.topic === rideChTopic);
    if (existingRideCh) {
      existingRideCh.send({ type: 'broadcast', event: 'counter_offer', payload: { price: offerPrice, driverId, rideId } });
    } else {
      const ch = supabase.channel(`ride_ch_${rideId}`, { config: { broadcast: { ack: false } } });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'counter_offer', payload: { price: offerPrice, driverId, rideId } });
          // No setTimeout removal — let pendingRideId useEffect manage this channel's lifecycle
        }
      });
    }

    // Save ride coords before clearing incomingRequest — React 18 batches state updates
    // so by the time the pendingRideId useEffect runs, incomingRequest is already null.
    pendingRideDataRef.current = incomingRequest.ride;

    setIncomingRequest(null);
    setAccepting(false);
    setPendingRideId(rideId);
    setPendingRequestId(requestId);
  }

  async function handleIgnore() {
    if (!incomingRequest) return;
    await supabase.from('ride_requests').update({ status: 'ignored' }).eq('id', incomingRequest.id);
    setIncomingRequest(null);
    setRequestRouteCoords([]);
    setTripInfo(null);
  }

  async function fetchRequestRoute(fromLng: number, fromLat: number, toLng: number, toLat: number) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes?.[0]) {
        const coords = (data.routes[0].geometry?.coordinates || []).map((c: number[]) => ({
          latitude: c[1], longitude: c[0],
        }));
        setRequestRouteCoords(coords);
      }
    } catch {}
  }

  // Get approximate area name for a coordinate (neighbourhood/suburb level — protects rider privacy)
  async function getApproxZone(lat: number, lng: number): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`;
      const res = await fetch(url, { headers: { 'User-Agent': 'WaslApp/1.0' } });
      const data = await res.json();
      const a = data.address || {};
      return (
        a.village || a.town || a.neighbourhood || a.suburb ||
        a.quarter || a.municipality || a.city_district || a.city ||
        a.county || data.display_name?.split(',')[0] || 'Unknown area'
      );
    } catch { return 'Unknown area'; }
  }

  // Get a human-readable label for the pickup location.
  // Tries street-level first (zoom=17), falls back to area/neighbourhood (zoom=14)
  // so the driver always sees a real place name instead of raw coordinates.
  async function getPickupLabel(lat: number, lng: number): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17`;
      const res = await fetch(url, { headers: { 'User-Agent': 'WaslApp/1.0' } });
      const data = await res.json();
      const a = data.address || {};

      // Street-level detail
      const street = a.road || a.pedestrian || a.footway || a.path || a.residential || '';

      // Area-level fallback (same fields as getApproxZone, so we always have something)
      const area =
        a.neighbourhood || a.suburb || a.quarter || a.village ||
        a.town || a.city_district || a.municipality || a.city || a.county || '';

      if (street && area) return `${street}, ${area}`;
      if (street)         return street;
      if (area)           return area;

      // Last resort: first two parts of display_name
      return data.display_name?.split(',').slice(0, 2).join(',').trim() || 'Pickup location';
    } catch {
      return 'Pickup location';
    }
  }

  // Fetch driver→pickup distance/ETA + dropoff zone in parallel
  async function fetchTripInfo(pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number) {
    // Use ref snapshot — `location` state may be stale in async closure
    const driverLat = locationRef.current?.latitude;
    const driverLng = locationRef.current?.longitude;

    const [dropoffZone, pickupLabel] = await Promise.all([
      getApproxZone(dropoffLat, dropoffLng),
      getPickupLabel(pickupLat, pickupLng),
    ]);

    let distanceKm: number | null = null;
    let etaMin: number | null = null;

    if (driverLat && driverLng) {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${driverLng},${driverLat};${pickupLng},${pickupLat}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes?.[0]) {
          distanceKm = Math.round(data.routes[0].distance / 100) / 10; // metres → km (1dp)
          etaMin = Math.ceil(data.routes[0].duration / 60);
        }
      } catch {}
    }

    setTripInfo({ distanceKm, etaMin, dropoffZone, pickupLabel });
  }

  async function initLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocation(loc.coords);
      if (!hasRequestRef.current) {
        mapRef.current?.animateToRegion({
          latitude: loc.coords.latitude, longitude: loc.coords.longitude,
          latitudeDelta: 0.01, longitudeDelta: 0.01,
        }, 1000);
      }
    } catch (e) {
      console.log('Location error:', e);
      // Fall back silently — map still shows with default region
    }
  }

  async function startLiveTracking() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      // Pre-activate keep-awake so expo-location's internal call doesn't throw an
      // uncaught "Unable to activate keep awake" rejection on devices/Expo Go.
      try { await activateKeepAwakeAsync(); } catch (_) {}

      // Save location immediately when going online — don't wait for movement
      try {
        const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation(currentLoc.coords);
        if (!hasRequestRef.current) {
          mapRef.current?.animateToRegion({
            latitude: currentLoc.coords.latitude, longitude: currentLoc.coords.longitude,
            latitudeDelta: 0.01, longitudeDelta: 0.01,
          }, 500);
        }
        if (driverDataRef.current) {
          await supabase.from("driver_presence").upsert({
              driver_id: driverDataRef.current.id,
              latitude: currentLoc.coords.latitude,
              longitude: currentLoc.coords.longitude,
              is_online: true,
            }, { onConflict: 'driver_id' });
        }
      } catch (e) {
        console.log('Initial location error:', e);
      }

      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        async (loc) => {
          try {
            setLocation(loc.coords);
            // Don't re-center map while showing a ride request — keep pickup+dropoff in view
            if (!hasRequestRef.current) {
              mapRef.current?.animateToRegion({
                latitude: loc.coords.latitude, longitude: loc.coords.longitude,
                latitudeDelta: 0.01, longitudeDelta: 0.01,
              }, 500);
            }
            // Don't re-write online if the driver has gone offline in the meantime.
            if (driverDataRef.current && onlineRef.current) {
              await supabase.from("driver_presence").upsert({
                driver_id: driverDataRef.current.id,
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                is_online: true,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'driver_id' });
            }
          } catch (e) {
            console.log('Tracking update error:', e);
          }
        }
      );
    } catch (e) {
      console.log('Live tracking error:', e);
    }
  }

  function startPulseAnimation() {
    const pulse = (scale: any, opacity: any, delay: number) => {
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.5, duration: 1500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.8, duration: 0, useNativeDriver: true }),
        ]),
      ])).start();
    };
    pulse(scale1, opacity1, 0);
    pulse(scale2, opacity2, 500);
    pulse(scale3, opacity3, 1000);
  }

  async function loadDriverData() {
    // Use getSession (local cache) — getUser() makes a network call that can fail silently
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, vehicle_type, approval_status, ban_message')
      .eq('id', user.id)
      .maybeSingle();

    const { data: presence } = await supabase
      .from('driver_presence')
      .select('is_online')
      .eq('driver_id', user.id)
      .maybeSingle();

    if (profile) {
      // Always start offline — driver must manually go online each session
      const driverInfo = { ...profile, is_online: false };
      setDriverData(driverInfo);
      driverDataRef.current = driverInfo;
      setIsOnline(false);
      try {
        await supabase.from('driver_presence').upsert(
          { driver_id: user.id, is_online: false },
          { onConflict: 'driver_id' }
        );
      } catch (_) {}
    }
  }

  async function toggleOnline() {
    if (!driverDataRef.current) return;
    const st = driverDataRef.current.approval_status;
    if (st === 'rejected' || st === 'suspended') {
      const banMsg = driverDataRef.current.ban_message;
      Alert.alert(
        ar ? 'الحساب محظور' : 'Account Banned',
        banMsg && String(banMsg).trim()
          ? String(banMsg)
          : (ar ? 'تم حظر حسابك. تواصل مع الدعم للمزيد.' : 'Your account has been banned. Please contact support.')
      );
      return;
    }
    setLoading(true);
    const newIsOnline = !isOnline;
    onlineRef.current = newIsOnline;
    if (!newIsOnline) { locationSub.current?.remove(); locationSub.current = null; }
    const { error } = await supabase.from('driver_presence').upsert({
      driver_id: driverDataRef.current.id,
      is_online: newIsOnline,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });
    if (error) Alert.alert('Error', error.message);
    else setIsOnline(newIsOnline);
    setLoading(false);
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        showsUserLocation
        customMapStyle={darkMode ? darkMapStyle : undefined}
        initialRegion={{
          latitude: location?.latitude ?? 34.4667,
          longitude: location?.longitude ?? 36.2833,
          latitudeDelta: 0.05, longitudeDelta: 0.05,
        }}
      >
        {/* Show pickup + dropoff + route on main map when a request is incoming */}
        {incomingRequest?.ride?.pickup_lat != null && incomingRequest?.ride?.pickup_lng != null && (
          <Marker coordinate={{
            latitude: Number(incomingRequest.ride.pickup_lat),
            longitude: Number(incomingRequest.ride.pickup_lng),
          }}>
            <View style={styles.mapMarkerA}><Text style={styles.mapMarkerLabel}>A</Text></View>
          </Marker>
        )}
        {incomingRequest?.ride?.dropoff_lat != null && incomingRequest?.ride?.dropoff_lng != null && (
          <Marker coordinate={{
            latitude: Number(incomingRequest.ride.dropoff_lat),
            longitude: Number(incomingRequest.ride.dropoff_lng),
          }}>
            <View style={styles.mapMarkerB}><Text style={styles.mapMarkerLabel}>B</Text></View>
          </Marker>
        )}
        {requestRouteCoords.length > 0 && (
          <Polyline coordinates={requestRouteCoords} strokeColor="#F4B400" strokeWidth={4} />
        )}
      </MapView>

      {/* TOP BAR — floating pill card */}
      <View style={[styles.topBar, {
        backgroundColor: cardBg,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: darkMode ? 0.4 : 0.14, shadowRadius: 12, elevation: 8,
      }]}>
        {/* Hamburger button */}
        <Pressable onPress={() => setShowMenu(true)} hitSlop={8}>
          <View style={[styles.menuBtn, {
            backgroundColor: darkMode ? '#111827' : '#F3F4F6',
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: darkMode ? 0.5 : 0.1, shadowRadius: 4, elevation: 3,
          }]}>
            <View style={[styles.menuLine, { backgroundColor: textColor }]} />
            <View style={[styles.menuLine, { backgroundColor: textColor }]} />
            <View style={[styles.menuLine, { backgroundColor: textColor, width: 14 }]} />
          </View>
        </Pressable>

        {/* Driver name + online badge */}
        <View style={styles.topBarRight}>
          <NotificationBell color={textColor} />
          <View style={[styles.onlineBadgeDot, {
            backgroundColor: isOnline ? '#16A34A' : '#9CA3AF',
            shadowColor: isOnline ? '#16A34A' : 'transparent',
            shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 0,
          }]} />
          <Text style={[styles.topBarTitle, { color: textColor }]}>
            {vehicleEmoji} {driverData?.full_name || (ar ? 'السائق' : 'Driver')}
          </Text>
        </View>
      </View>

      {/* WAITING FOR RIDER RESPONSE BANNER */}
      {pendingRideId && !incomingRequest && (
        <View style={[styles.waitingBanner, { backgroundColor: cardBg }]}>
          <View style={[styles.waitingIconCircle, { backgroundColor: darkMode ? '#374151' : '#F3F4F6' }]}>
            <Text style={{ fontSize: 32 }}>⏳</Text>
          </View>
          <Text style={[styles.waitingTitle, { color: textColor }]}>{ar ? 'بانتظار رد الراكب...' : 'Waiting for rider response...'}</Text>
          <Text style={[styles.waitingSubtext, { color: subtextColor }]}>{ar ? 'أرسلت عرضك — ستُنقل فور القبول' : 'Your offer was sent — you\'ll be taken to the trip when accepted'}</Text>
          <Pressable onPress={() => { setPendingRideId(null); setPendingRequestId(null); }} style={[styles.cancelWaitBtn, { borderColor: dividerColor }]}>
            <Text style={[styles.cancelWaitText, { color: textColor }]}>{ar ? 'إلغاء العرض' : 'Cancel Offer'}</Text>
          </Pressable>
        </View>
      )}

      {/* SEARCHING ANIMATION */}
      {isOnline && !pendingRideId && (
        <View style={styles.searchingContainer}>
          <View style={styles.pulseWrapper}>
            <Animated.View style={[styles.pulseCircle, { transform: [{ scale: scale1 }], opacity: opacity1 }]} />
            <Animated.View style={[styles.pulseCircle, { transform: [{ scale: scale2 }], opacity: opacity2 }]} />
            <Animated.View style={[styles.pulseCircle, { transform: [{ scale: scale3 }], opacity: opacity3 }]} />
            <View style={styles.centerDot}>
              <Text style={{ fontSize: 28 }}>{vehicleEmoji}</Text>
            </View>
          </View>
          <Text style={[styles.searchingText, { color: textColor }]}>{ar ? 'البحث عن ركاب...' : 'Searching for customers...'}</Text>
          <Text style={[styles.searchingSubtext, { color: subtextColor }]}>{ar ? 'أنت مرئي للركاب القريبين' : 'You are visible to nearby riders'}</Text>
        </View>
      )}

      {/* BOTTOM CARD */}
      <View style={[styles.bottomCard, { backgroundColor: cardBg }]}>
        {pendingRideId ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <ActivityIndicator color="#F4B400" size="small" />
            <Text style={[styles.offlineTitle, { color: textColor, textAlign: 'center' }]}>
              {ar ? '⏳ بانتظار رد الراكب' : '⏳ Awaiting rider response'}
            </Text>
            <Text style={[styles.offlineSubtitle, { color: subtextColor, textAlign: 'center' }]}>
              {ar ? 'لا يمكنك استقبال طلبات جديدة الآن' : 'You cannot receive new requests right now'}
            </Text>
          </View>
        ) : (
          <>
            {!isOnline && (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.offlineTitle, { color: textColor }]}>{ar ? 'أنت غير متصل' : 'You are offline'}</Text>
                <Text style={[styles.offlineSubtitle, { color: subtextColor }]}>
                  {ar ? 'اضغط "اتصل الآن" لتلقي الطلبات' : 'Press Go Online to start receiving requests'}
                </Text>
              </View>
            )}
            <Pressable onPress={toggleOnline} disabled={loading}>
              <View style={[styles.onlineBtn, isOnline && styles.offlineBtn]}>
                <Text style={styles.onlineBtnText}>
                  {loading ? '...' : isOnline ? (ar ? '🔴 إيقاف الاتصال' : '🔴 Go Offline') : (ar ? '🟢 اتصل الآن' : '🟢 Go Online')}
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>

      {/* INCOMING RIDE REQUEST — floats over the main map */}
      {!!incomingRequest && (() => {
        // Parse delivery info packed into the note field
        let delivery: any = null;
        try {
          const parsed = JSON.parse(incomingRequest?.ride?.note || '');
          if (parsed._t === 'store' || parsed._t === 'pkg') delivery = parsed;
        } catch {}
        const isStore = delivery?._t === 'store';
        const isPkg   = delivery?._t === 'pkg';

        // Card accent colour: orange for store, purple for package, gold for ride
        const accent = isStore ? '#F97316' : isPkg ? '#8B5CF6' : '#F4B400';
        const timerBorder = requestTimer <= 5 ? '#EF4444' : accent;

        return (
        <View style={styles.requestCard}>
          <View style={[styles.requestCardInner, { backgroundColor: cardBg, borderTopWidth: 4, borderTopColor: accent }]}>

            {/* ── Header: title + countdown ── */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.requestTitle, { color: textColor }]}>
                  {isStore
                    ? (ar ? '📦 طلب من متجر' : '📦 Store Delivery')
                    : isPkg
                    ? (ar ? '📬 إرسال طرد' : '📬 Package Delivery')
                    : `${vehicleEmoji} ${ar ? 'طلب ركوب جديد!' : 'New Ride Request!'}`}
                </Text>
                {(isStore || isPkg) && (
                  <View style={[{ marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: accent + '22' }]}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: accent }}>
                      {isStore ? (ar ? 'توصيل طلب' : 'DELIVERY') : (ar ? 'توصيل طرد' : 'PACKAGE')}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{
                width: 44, height: 44, borderRadius: 22, borderWidth: 3,
                alignItems: 'center', justifyContent: 'center',
                borderColor: timerBorder,
              }}>
                <Text style={{ fontSize: 16, fontWeight: '900', color: timerBorder }}>
                  {requestTimer}
                </Text>
              </View>
            </View>

            {/* ── Delivery info block (store or package) ── */}
            {isStore && (
              <View style={[styles.deliveryBlock, { backgroundColor: '#F9730622', borderColor: '#F9730644' }]}>
                <View style={styles.deliveryRow}>
                  <Text style={styles.deliveryIcon}>🏪</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'المتجر' : 'Store'}</Text>
                    <Text style={[styles.deliveryValue, { color: textColor }]} numberOfLines={1}>
                      {delivery.store || (ar ? 'غير محدد' : 'Not specified')}
                    </Text>
                  </View>
                </View>
                {!!delivery.items && (
                  <View style={[styles.deliveryRow, { borderTopWidth: 1, borderTopColor: '#F9730633' }]}>
                    <Text style={styles.deliveryIcon}>🛒</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'الطلب' : 'Items'}</Text>
                      <Text style={[styles.deliveryValue, { color: textColor }]} numberOfLines={2}>
                        {delivery.items}
                      </Text>
                    </View>
                  </View>
                )}
                {!!delivery.phone && (
                  <View style={[styles.deliveryRow, { borderTopWidth: 1, borderTopColor: '#F9730633' }]}>
                    <Text style={styles.deliveryIcon}>📞</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'هاتف العميل' : 'Customer Phone'}</Text>
                      <Text style={[styles.deliveryValue, { color: textColor }]}>+961 {delivery.phone}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {isPkg && (
              <View style={[styles.deliveryBlock, { backgroundColor: '#8B5CF622', borderColor: '#8B5CF644' }]}>
                <View style={styles.deliveryRow}>
                  <Text style={styles.deliveryIcon}>📦</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'نوع الشحنة' : 'Package Type'}</Text>
                    <Text style={[styles.deliveryValue, { color: textColor }]}>
                      {delivery.item || (ar ? 'غير محدد' : 'Not specified')}
                    </Text>
                  </View>
                </View>
                {!!delivery.note && (
                  <View style={[styles.deliveryRow, { borderTopWidth: 1, borderTopColor: '#8B5CF633' }]}>
                    <Text style={styles.deliveryIcon}>📝</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'ملاحظة' : 'Note'}</Text>
                      <Text style={[styles.deliveryValue, { color: textColor }]} numberOfLines={2}>
                        {delivery.note}
                      </Text>
                    </View>
                  </View>
                )}
                <View style={[styles.deliveryRow, { borderTopWidth: 1, borderTopColor: '#8B5CF633' }]}>
                  <Text style={styles.deliveryIcon}>📞</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deliveryLabel, { color: subtextColor }]}>{ar ? 'المرسل / المستلم' : 'Sender / Recipient'}</Text>
                    <Text style={[styles.deliveryValue, { color: textColor }]}>
                      {delivery.sender ? `+961 ${delivery.sender}` : '—'} → {delivery.recipient ? `+961 ${delivery.recipient}` : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── Trip locations ── */}
            <View style={[styles.locationBlock, { backgroundColor: darkMode ? '#374151' : '#F3F4F6' }]}>
              <View style={styles.locationRow}>
                <View style={[styles.locDot, { backgroundColor: '#16A34A' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locLabel, { color: subtextColor }]}>
                    {isStore ? (ar ? 'موقع المتجر' : 'Store location') : isPkg ? (ar ? 'موقع الاستلام' : 'Pickup') : (ar ? 'الاستلام (دقيق)' : 'Pickup (exact)')}
                  </Text>
                  <Text style={[styles.locValue, { color: textColor }]} numberOfLines={1}>
                    {tripInfo?.pickupLabel || '...'}
                  </Text>
                </View>
              </View>
              <View style={styles.locConnector} />
              <View style={styles.locationRow}>
                <View style={[styles.locDot, { backgroundColor: accent }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locLabel, { color: subtextColor }]}>
                    {isStore || isPkg ? (ar ? 'منطقة التوصيل' : 'Drop-off area') : (ar ? 'منطقة الوجهة' : 'Drop-off area')}
                  </Text>
                  <Text style={[styles.locValue, { color: textColor }]}>
                    {tripInfo?.dropoffZone || '...'}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Stats row: ETA to pickup + price ── */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: textColor }]}>
                  {tripInfo?.etaMin != null ? `~${tripInfo.etaMin} min` : '—'}
                </Text>
                <Text style={[styles.statLabel, { color: subtextColor }]}>
                  {tripInfo?.distanceKm != null
                    ? `${tripInfo.distanceKm} km away`
                    : (ar ? 'وقت الوصول' : 'to pickup')}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: darkMode ? '#374151' : '#E5E7EB' }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: accent }]}>
                  {riderPrice > 0 ? riderPrice.toLocaleString() : '—'} {ar ? 'ل.ل' : 'L.L'}
                </Text>
                <Text style={[styles.statLabel, { color: subtextColor }]}>
                  {isStore || isPkg ? (ar ? 'سعر التوصيل' : 'Delivery price') : (ar ? 'سعر الراكب' : "Rider's price")}
                </Text>
              </View>
            </View>

            {/* ── Price adjuster ── */}
            <View style={[styles.priceRow, { backgroundColor: darkMode ? '#374151' : '#F3F4F6' }]}>
              <Pressable onPress={() => setOfferPrice(p => Math.max(50000, p - 50000))} style={styles.priceAdjBtn}>
                <Text style={styles.priceAdjText}>−</Text>
              </Pressable>
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.priceValue, { color: offerPrice !== riderPrice ? accent : textColor }]}>
                  {offerPrice > 0 ? offerPrice.toLocaleString() : '—'} {ar ? 'ل.ل' : 'L.L'}
                </Text>
                <Text style={[styles.requestLabel, { color: subtextColor }]}>
                  {offerPrice !== riderPrice
                    ? (ar ? 'عرضك (مختلف)' : 'Your counter-offer')
                    : (ar ? 'قبول السعر' : 'Accept price')}
                </Text>
              </View>
              <Pressable onPress={() => setOfferPrice(p => p + 50000)} style={[styles.priceAdjBtn, { backgroundColor: accent }]}>
                <Text style={[styles.priceAdjText, { color: '#fff' }]}>+</Text>
              </Pressable>
            </View>

            {/* ── Plain text note (normal rides only) ── */}
            {!delivery && !!incomingRequest?.ride?.note && (
              <View style={[styles.requestInfo, { backgroundColor: darkMode ? '#374151' : '#F9FAFB', marginBottom: 4 }]}>
                <Text style={[styles.requestLabel, { color: subtextColor }]}>{ar ? 'ملاحظة' : 'Note'}</Text>
                <Text style={[styles.requestValue, { color: textColor }]}>{incomingRequest.ride.note}</Text>
              </View>
            )}

            {/* ── Buttons ── */}
            {offerPrice !== riderPrice ? (
              /* Driver changed the price — only show Send Counter */
              <Pressable
                onPress={handleCounterOffer}
                disabled={accepting}
                style={styles.counterOfferBtn}
              >
                {accepting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.counterOfferBtnText}>
                      {ar ? `📤 إرسال عرض ${offerPrice.toLocaleString()} ل.ل` : `📤 Send Counter: ${offerPrice.toLocaleString()} L.L`}
                    </Text>}
              </Pressable>
            ) : (
              /* Price unchanged — show Ignore + Accept */
              <View style={styles.requestBtns}>
                <Pressable onPress={handleIgnore} style={styles.ignoreBtn}>
                  <Text style={styles.ignoreBtnText}>{ar ? 'تجاهل' : 'Ignore'}</Text>
                </Pressable>
                <Pressable
                  onPress={handleAccept}
                  disabled={accepting}
                  style={styles.acceptBtn}
                >
                  {accepting
                    ? <ActivityIndicator color="#111827" />
                    : <Text style={styles.acceptBtnText}>{ar ? '✅ قبول' : '✅ Accept'}</Text>}
                </Pressable>
              </View>
            )}

          </View>
        </View>
        );
      })()}

      {/* MENU MODAL — opens from LEFT */}
      <Modal visible={showMenu} transparent animationType="fade">
        <Pressable style={styles.menuOverlay} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuCard, { backgroundColor: cardBg }]}>

            {/* ── ACCOUNT ── */}
            <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>
              {ar ? 'الحساب' : 'ACCOUNT'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setShowMenu(false); router.push('/profile' as never); }}>
              <Text style={styles.menuItemIcon}>👤</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>{ar ? 'الملف الشخصي' : 'My Profile'}</Text>
              <Text style={[styles.menuArrow, { color: subtextColor }]}>›</Text>
            </Pressable>

            {/* ── SETTINGS ── */}
            <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 14 }]}>
              {ar ? 'الإعدادات' : 'SETTINGS'}
            </Text>
            <Pressable style={[styles.menuItem, { backgroundColor: itemBg }]}
              onPress={() => { setLocale(locale === 'en' ? 'ar' : 'en'); setShowMenu(false); }}>
              <Text style={styles.menuItemIcon}>🌐</Text>
              <Text style={[styles.menuItemText, { color: textColor }]}>{ar ? 'English' : 'العربية'}</Text>
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

            {/* ── SUPPORT ── */}
            <Text style={[styles.sectionLabel, { color: sectionLabelColor, marginTop: 14 }]}>
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
                const driverId = driverDataRef.current?.id;
                if (driverId) {
                  await supabase.from('driver_presence')
                    .update({ is_online: false })
                    .eq('driver_id', driverId);
                }
                locationSub.current?.remove();
                setIsOnline(false);
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
  // ── Top bar ──────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    zIndex: 10, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 12,
  },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  topBarTitle: { fontSize: 15, fontWeight: '800' },
  onlineBadgeDot: { width: 9, height: 9, borderRadius: 5 },
  menuBtn: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 4 },
  menuLine: { width: 20, height: 2.5, borderRadius: 2 },
  menuDot: { width: 5, height: 5, borderRadius: 3 }, // kept for safety

  // ── Map markers ───────────────────────────────────────────────────────────
  mapMarkerA: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  mapMarkerB: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F4B400', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  mapMarkerLabel: { color: '#fff', fontSize: 11, fontWeight: '900' },
  centerDot: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(244,180,0,0.2)', borderWidth: 2, borderColor: '#F4B400', alignItems: 'center', justifyContent: 'center' },

  // ── Searching / online state ──────────────────────────────────────────────
  pulseWrapper: { alignItems: 'center', justifyContent: 'center', width: 120, height: 120 },
  pulseCircle: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#F4B400' },
  searchingContainer: {
    position: 'absolute', bottom: 180, alignSelf: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 24,
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 14,
  },
  searchingText: { fontSize: 15, fontWeight: '700', marginTop: 10 },
  searchingSubtext: { fontSize: 12, fontWeight: '500', marginTop: 4 },

  // ── Bottom card (online/offline toggle) ───────────────────────────────────
  bottomCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 14,
  },
  offlineTitle: { fontSize: 17, fontWeight: '900', marginBottom: 4 },
  offlineSubtitle: { fontSize: 13, fontWeight: '500' },
  onlineBtn: {
    backgroundColor: '#16A34A', borderRadius: 18, paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#16A34A', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 7,
  },
  offlineBtn: { backgroundColor: '#374151' },
  onlineBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  cancelWaitBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  cancelWaitText: { fontSize: 14, fontWeight: '700' },

  // ── Waiting banner ────────────────────────────────────────────────────────
  waitingBanner: {
    position: 'absolute', top: 120, left: 24, right: 24,
    borderRadius: 20, padding: 20, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  waitingIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  waitingTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  waitingSubtext: { fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 4 },

  // ── Incoming request card ─────────────────────────────────────────────────
  requestCard: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  requestCardInner: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 16, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18, shadowRadius: 18, elevation: 20,
  },
  requestTitle: { fontSize: 18, fontWeight: '900' },

  // Delivery info block (store / package)
  deliveryBlock: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  deliveryRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 10 },
  deliveryIcon: { fontSize: 18, width: 26, textAlign: 'center', marginTop: 1 },
  deliveryLabel: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  deliveryValue: { fontSize: 14, fontWeight: '700', lineHeight: 20 },

  // Location rows
  locationBlock: { borderRadius: 14, padding: 12, marginBottom: 10 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  locDot: { width: 10, height: 10, borderRadius: 5 },
  locConnector: { width: 2, height: 10, backgroundColor: '#9CA3AF', marginLeft: 4, marginVertical: 2 },
  locLabel: { fontSize: 11, fontWeight: '600' },
  locValue: { fontSize: 14, fontWeight: '700', marginTop: 1 },

  // Stats row
  statsRow: { flexDirection: 'row', borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statValue: { fontSize: 17, fontWeight: '900' },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1 },

  // Price adjuster
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: 10, marginBottom: 10 },
  priceAdjBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  priceAdjText: { fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: 28 },
  priceValue: { fontSize: 20, fontWeight: '900' },
  requestLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  requestInfo: { borderRadius: 10, padding: 10, marginBottom: 4 },
  requestValue: { fontSize: 13, fontWeight: '600', marginTop: 2 },

  // Accept / Ignore buttons
  requestBtns: { flexDirection: 'row', gap: 10 },
  ignoreBtn: { flex: 1, paddingVertical: 15, borderRadius: 16, backgroundColor: '#374151', alignItems: 'center' },
  ignoreBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  acceptBtn: { flex: 2, paddingVertical: 15, borderRadius: 16, backgroundColor: '#F4B400', alignItems: 'center' },
  acceptBtnText: { color: '#111827', fontWeight: '900', fontSize: 15 },
  counterOfferBtn: { paddingVertical: 15, borderRadius: 16, backgroundColor: '#1D4ED8', alignItems: 'center' },
  counterOfferBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // ── Side menu ─────────────────────────────────────────────────────────────
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row' },
  menuCard: { width: 290, paddingTop: 64, paddingHorizontal: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, marginBottom: 6 },
  menuItemIcon: { fontSize: 20, width: 32 },
  menuItemText: { flex: 1, fontSize: 15, fontWeight: '600' },
  menuArrow: { fontSize: 20, fontWeight: '700' },
});
