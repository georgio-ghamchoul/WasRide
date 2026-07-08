import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Modal, BackHandler } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAppState } from '@/lib/app-state'

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type Phase = 'searching' | 'pending' | 'accepted' | 'no_drivers'

const RADIUS_STEPS = [3, 5, 8, 10]

export default function WaitingScreen() {
  const router = useRouter()
  const params = useLocalSearchParams()
  const rideId = params.rideId as string
  const vehicleFilterParam = (params.vehicleFilter as string) || 'fastest'
  const { locale, darkMode } = useAppState()
  const ar = locale === 'ar'
  const dark = darkMode

  const bg = dark ? '#0F172A' : '#fff'
  const cardBg = dark ? '#1E293B' : '#F9FAFB'
  const cardBorder = dark ? '#334155' : '#E5E7EB'
  const textColor = dark ? '#F1F5F9' : '#111827'
  const subtextColor = dark ? '#94A3B8' : '#6B7280'

  const [phase, setPhase] = useState<Phase>('searching')
  const [searchStep, setSearchStep] = useState(0)
  const [searchRadius, setSearchRadius] = useState(RADIUS_STEPS[0])
  const [sentCount, setSentCount] = useState(0)
  const [acceptedDriver, setAcceptedDriver] = useState<any>(null)
  const [counterOffer, setCounterOffer] = useState<{ price: number } | null>(null)
  const [counterTimer, setCounterTimer] = useState(10)
  const [rideData, setRideData] = useState<any>(null)

  const cancelledRef = useRef(false)
  const searchingRef = useRef(false)
  const navigatedRef = useRef(false)
  const rideDataRef = useRef<any>(null)
  const vehicleTypeRef = useRef('')
  const driverLatRef = useRef<number | null>(null)
  const driverLngRef = useRef<number | null>(null)
  const driverNameRef = useRef('')
  const driverPhoneRef = useRef('')

  // Init on mount
  useEffect(() => {
    if (!rideId) return
    initSearch()
  }, [rideId])

  // Hardware back while searching = cancel the search and go home (no penalty).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigatedRef.current) return false // already moved on (accepted/cancelled)
      cancelRide()
      return true
    })
    return () => sub.remove()
  }, [])

  // Broadcast channel — primary path, bypasses RLS entirely
  useEffect(() => {
    if (!rideId) return
    const ch = supabase.channel('ride_ch_' + rideId)
    ch
      .on('broadcast', { event: 'driver_accepted' }, async (msg) => {
        const { driverId } = msg.payload
        console.log('📢 Broadcast: driver_accepted, driverId:', driverId)
        if (driverId) await loadDriver(driverId)
        // Rider does the rides update (passenger_id = auth.uid() — always allowed)
        await supabase.from('rides').update({ status: 'accepted', driver_id: driverId }).eq('id', rideId)
        if (!navigatedRef.current) {
          navigatedRef.current = true
          setPhase('accepted')
          setTimeout(() => router.replace({ pathname: '/tracking', params: { rideId, driverId: driverId || '', pickupLat: rideDataRef.current?.pickup_lat ?? '', pickupLng: rideDataRef.current?.pickup_lng ?? '', dropoffLat: rideDataRef.current?.dropoff_lat ?? '', dropoffLng: rideDataRef.current?.dropoff_lng ?? '', vehicleType: vehicleTypeRef.current, driverLat: driverLatRef.current?.toString() ?? '', driverLng: driverLngRef.current?.toString() ?? '', driverName: driverNameRef.current, driverPhone: driverPhoneRef.current } } as never), 2000)
        }
      })
      .on('broadcast', { event: 'counter_offer' }, (msg) => {
        const { price, driverId } = msg.payload
        console.log('📢 Broadcast: counter_offer, price:', price, 'driverId:', driverId)
        if (driverId) loadDriver(driverId)
        // Always use broadcast price — most accurate, no DB read needed
        setCounterOffer({ price })
        setCounterTimer(10)
      })
      .subscribe((status) => {
        console.log('📡 Rider broadcast channel status:', status)
      })
    return () => { supabase.removeChannel(ch) }
  }, [rideId])

  // Watch rides table — catches 'accepted' and 'counter_offer' status
  useEffect(() => {
    if (!rideId) return
    const channel = supabase.channel('ride_status_' + rideId)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rides',
        filter: `id=eq.${rideId}`
      }, async (payload) => {
        const st = payload.new.status
        console.log('🚕 Ride status update:', st)
        if (st === 'accepted' && !navigatedRef.current) {
          navigatedRef.current = true
          if (payload.new.driver_id) await loadDriver(payload.new.driver_id)
          setPhase('accepted')
          setTimeout(() => router.replace({ pathname: '/tracking', params: { rideId, driverId: payload.new.driver_id || '', pickupLat: rideDataRef.current?.pickup_lat ?? '', pickupLng: rideDataRef.current?.pickup_lng ?? '', dropoffLat: rideDataRef.current?.dropoff_lat ?? '', dropoffLng: rideDataRef.current?.dropoff_lng ?? '', vehicleType: vehicleTypeRef.current, driverLat: driverLatRef.current?.toString() ?? '', driverLng: driverLngRef.current?.toString() ?? '', driverName: driverNameRef.current, driverPhone: driverPhoneRef.current } } as never), 2000)
        } else if (st === 'counter_offer') {
          console.log('💬 rides DB sub: counter_offer, price:', payload.new.price)
          if (payload.new.driver_id) loadDriver(payload.new.driver_id)
          setCounterTimer(10)
          // Broadcast is the single source of truth for price.
          // DB price may be stale if RLS blocked the update — only use as fallback.
          if (payload.new.price) setCounterOffer(prev => prev !== null ? prev : { price: payload.new.price })
        }
      }).subscribe((status) => {
        console.log('📡 Rides subscription status:', status)
      })
    return () => { supabase.removeChannel(channel) }
  }, [rideId])

  // Watch ride_requests table — fallback for counter_offer detection
  useEffect(() => {
    if (!rideId) return
    const channel = supabase.channel('ride_reqs_' + rideId)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'ride_requests',
        filter: `ride_id=eq.${rideId}`
      }, async (payload) => {
        console.log('📋 Ride request update:', payload.new.status)
        if (payload.new.status === 'counter_offer') {
          // Fetch updated price + driver from rides
          const { data: ride } = await supabase.from('rides')
            .select('price, driver_id').eq('id', rideId).maybeSingle()
          console.log('💬 ride_requests sub: counter_offer, ride:', ride)
          if (ride) {
            if (ride.driver_id) loadDriver(ride.driver_id)
            // Always update price — broadcast already set it but use DB value as confirmation
            if (ride.price) setCounterOffer({ price: ride.price })
            setCounterTimer(10)
          }
        } else if (payload.new.status === 'accepted' && !navigatedRef.current) {
          // A driver accepted directly — load ride to get driver_id
          const { data: ride } = await supabase.from('rides')
            .select('driver_id, status').eq('id', rideId).maybeSingle()
          if (ride?.status === 'accepted' && ride.driver_id) {
            navigatedRef.current = true
            await loadDriver(ride.driver_id)
            setPhase('accepted')
            setTimeout(() => router.replace({ pathname: '/tracking', params: { rideId, driverId: ride.driver_id, pickupLat: rideDataRef.current?.pickup_lat ?? '', pickupLng: rideDataRef.current?.pickup_lng ?? '', dropoffLat: rideDataRef.current?.dropoff_lat ?? '', dropoffLng: rideDataRef.current?.dropoff_lng ?? '', vehicleType: vehicleTypeRef.current, driverLat: driverLatRef.current?.toString() ?? '', driverLng: driverLngRef.current?.toString() ?? '', driverName: driverNameRef.current, driverPhone: driverPhoneRef.current } } as never), 2000)
          }
        }
      }).subscribe((status) => {
        console.log('📡 Ride requests subscription status:', status)
      })
    return () => { supabase.removeChannel(channel) }
  }, [rideId])

  // Polling fallback — check ride status every 3s while pending
  // This ensures counter_offer is caught even if realtime subscription misses it
  useEffect(() => {
    if (phase !== 'pending' && phase !== 'searching') return
    if (!rideId) return
    const interval = setInterval(async () => {
      const { data: ride } = await supabase.from('rides')
        .select('status, price, driver_id').eq('id', rideId).maybeSingle()
      if (!ride) return
      if (ride.status === 'counter_offer') {
        console.log('🔄 Polling caught counter_offer! price:', ride.price)
        if (ride.driver_id) loadDriver(ride.driver_id)
        setCounterTimer(t => t > 0 ? t : 10)
        // Broadcast is the single source of truth for price.
        // Only use DB price as fallback if broadcast was missed (counterOffer still null).
        setCounterOffer(prev => prev !== null ? prev : { price: ride.price })
      } else if (ride.status === 'accepted' && !navigatedRef.current) {
        console.log('🔄 Polling caught accepted!')
        navigatedRef.current = true
        if (ride.driver_id) await loadDriver(ride.driver_id)
        setPhase('accepted')
        clearInterval(interval)
        setTimeout(() => router.replace({ pathname: '/tracking', params: { rideId, driverId: ride.driver_id || '', pickupLat: rideDataRef.current?.pickup_lat ?? '', pickupLng: rideDataRef.current?.pickup_lng ?? '', dropoffLat: rideDataRef.current?.dropoff_lat ?? '', dropoffLng: rideDataRef.current?.dropoff_lng ?? '', vehicleType: vehicleTypeRef.current, driverLat: driverLatRef.current?.toString() ?? '', driverLng: driverLngRef.current?.toString() ?? '', driverName: driverNameRef.current, driverPhone: driverPhoneRef.current } } as never), 2000)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [phase, rideId, counterOffer])

  // Counter-offer auto-reject countdown
  useEffect(() => {
    if (!counterOffer) return
    if (counterTimer <= 0) {
      handleDeclineOffer()
      return
    }
    const t = setTimeout(() => setCounterTimer(p => p - 1), 1000)
    return () => clearTimeout(t)
  }, [counterOffer, counterTimer])

  async function initSearch() {
    const { data } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle()
    if (data) {
      setRideData(data)
      rideDataRef.current = data
      // Pass ride data directly — don't rely on rideData state (async, still null here)
      await sendToNearbyDrivers(data.pickup_lat, data.pickup_lng, data)
    }
  }

  async function loadDriver(driverId: string) {
    const { data } = await supabase.from('profiles').select('id, full_name, vehicle_type, phone').eq('id', driverId).maybeSingle()
    if (data) {
      vehicleTypeRef.current = data.vehicle_type || ''
      driverNameRef.current = data.full_name || ''
      driverPhoneRef.current = data.phone || ''
      const photoUrl = supabase.storage.from('driver-images').getPublicUrl(`drivers/${driverId}.jpg`).data.publicUrl
      setAcceptedDriver({ ...data, driver_image: photoUrl, rating: 5 })
    }
    // Always fetch driver location regardless of whether profile loaded
    const { data: presence } = await supabase.from('driver_presence')
      .select('latitude, longitude').eq('driver_id', driverId).maybeSingle()
    if (presence?.latitude && presence?.longitude) {
      driverLatRef.current = presence.latitude
      driverLngRef.current = presence.longitude
    }
  }

  async function sendToNearbyDrivers(pickupLat: number, pickupLng: number, rideSnapshot?: any) {
    if (cancelledRef.current) return
    if (searchingRef.current) return
    searchingRef.current = true
    setPhase('searching')
    // Use passed-in snapshot if provided (avoids stale rideData state on first call)
    const ride = rideSnapshot ?? rideData

    // Enforce a minimum 3-second searching animation before moving to pending,
    // even if drivers are found instantly — so the screen doesn't just flash
    const searchStartTime = Date.now()
    const MIN_SEARCH_MS = 3000

    for (let i = 0; i < RADIUS_STEPS.length; i++) {
      if (cancelledRef.current) return
      const km = RADIUS_STEPS[i]
      setSearchStep(i)
      setSearchRadius(km)

      // Fetch online driver locations from driver_presence
      const { data: presence } = await supabase.from('driver_presence')
        .select('driver_id, latitude, longitude').eq('is_online', true)

      let pool: any[] = []
      if (presence?.length) {
        const ids = presence.map(d => d.driver_id)
        const { data: profilesList } = await supabase.from('public_profiles')
          .select('id, full_name, vehicle_type').in('id', ids)

        const vehicleFilter = vehicleFilterParam

        pool = presence
          .map(p => {
            const prof = profilesList?.find(x => x.id === p.driver_id)
            return {
              id: p.driver_id,
              latitude: p.latitude,
              longitude: p.longitude,
              full_name: prof?.full_name || '',
              vehicle_type: prof?.vehicle_type || '',
              dist: getDistanceKm(pickupLat, pickupLng, p.latitude, p.longitude),
            }
          })
          .filter(d => d.dist <= km)
          .filter(d =>
            vehicleFilter === 'fastest'
              ? (d.vehicle_type === 'Motorcycle' || d.vehicle_type === 'Tuktuk')
              : d.vehicle_type === vehicleFilter
          )
          .sort((a, b) => a.dist - b.dist)
      }

      console.log(`🔍 Radius ${km}km — online drivers: ${presence?.length ?? 0}, in range: ${pool.length}`)

      if (pool.length > 0) {
        // Skip drivers already sent a request for this ride
        const { data: existingReqs } = await supabase.from('ride_requests')
          .select('driver_id').eq('ride_id', rideId)
        const alreadySent = new Set((existingReqs || []).map((r: any) => r.driver_id))
        const newDrivers = pool.filter(d => !alreadySent.has(d.id)).slice(0, 5)

        if (newDrivers.length > 0) {
          const { error } = await supabase.from('ride_requests').insert(
            newDrivers.map(d => ({ ride_id: rideId, driver_id: d.id, status: 'pending' }))
          )
          if (error) {
            console.log('⚠ ride_requests insert error (RLS?):', error.message)
          }
          // Always count + broadcast — don't let a DB/RLS error block the driver notification
          setSentCount(prev => prev + newDrivers.length)
          const ridePayload = {
            rideId,
            price: ride?.price,
            pickup_lat: pickupLat,
            pickup_lng: pickupLng,
            dropoff_lat: ride?.dropoff_lat,
            dropoff_lng: ride?.dropoff_lng,
            note: ride?.note,
            service: ride?.service,
            vehicleFilter: vehicleFilterParam,
          }
          for (const d of newDrivers) {
            const ch = supabase.channel('driver_ride_data_' + d.id, { config: { broadcast: { ack: false } } })
            ch.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                ch.send({ type: 'broadcast', event: 'new_ride_data', payload: ridePayload })
                setTimeout(() => supabase.removeChannel(ch), 3000)
              }
            })
          }
        } else {
          // All nearby drivers already contacted
          setSentCount(pool.length)
        }

        // Wait out the minimum search time before switching to pending
        const elapsed = Date.now() - searchStartTime
        if (elapsed < MIN_SEARCH_MS) {
          await new Promise(r => setTimeout(r, MIN_SEARCH_MS - elapsed))
        }
        if (cancelledRef.current) return
        setPhase('pending')
        searchingRef.current = false
        return
      }

      // Wait before expanding radius (except last step)
      if (i < RADIUS_STEPS.length - 1) {
        await new Promise(r => setTimeout(r, 10000))
      }
    }

    // No drivers found in any radius
    setPhase('no_drivers')
    searchingRef.current = false
  }

  // Send a broadcast on ride_ch_{rideId}.
  // The rider is ALREADY subscribed to this channel (useEffect above), so we
  // must reuse that existing channel instead of creating a new one — calling
  // supabase.channel() with the same name returns the cached instance and
  // .subscribe() on it never fires again, meaning .send() would never run.
  function sendRiderBroadcast(event: string, payload: Record<string, any>) {
    const topic = `realtime:ride_ch_${rideId}`
    const existing = supabase.getChannels().find((c: any) => c.topic === topic)
    if (existing) {
      existing.send({ type: 'broadcast', event, payload })
    } else {
      // Fallback: fresh channel (shouldn't normally be needed)
      const ch = supabase.channel('ride_ch_send_' + rideId + '_' + Date.now())
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event, payload })
          setTimeout(() => supabase.removeChannel(ch), 3000)
        }
      })
    }
  }

  async function handleAcceptOffer() {
    if (!counterOffer) return
    const driverId = acceptedDriver?.id
    setCounterOffer(null)

    // Update rides — persist the agreed counter-offer price AND the driver_id so the
    // ride is correctly attributed (rider passes RLS, so this reliably sticks). Without
    // driver_id the ride ends up with no driver and is skipped in earnings totals.
    await supabase.from('rides').update({ status: 'accepted', price: counterOffer.price, driver_id: driverId }).eq('id', rideId)

    // Mark ride_request as accepted
    if (driverId) {
      await supabase.from('ride_requests')
        .update({ status: 'accepted' })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
    }

    // Broadcast to driver — reuse existing subscription channel
    sendRiderBroadcast('rider_accepted', { rideId })

    // Navigate rider
    if (!navigatedRef.current) {
      navigatedRef.current = true
      setPhase('accepted')
      const navDriverId = driverId || acceptedDriver?.id || ''
      setTimeout(() => router.replace({ pathname: '/tracking', params: { rideId, driverId: navDriverId, pickupLat: rideDataRef.current?.pickup_lat ?? '', pickupLng: rideDataRef.current?.pickup_lng ?? '', dropoffLat: rideDataRef.current?.dropoff_lat ?? '', dropoffLng: rideDataRef.current?.dropoff_lng ?? '', vehicleType: vehicleTypeRef.current, driverLat: driverLatRef.current?.toString() ?? '', driverLng: driverLngRef.current?.toString() ?? '', driverName: driverNameRef.current, driverPhone: driverPhoneRef.current } } as never), 1500)
    }
  }

  async function handleDeclineOffer() {
    if (!counterOffer) return
    setCounterOffer(null)
    const drId = acceptedDriver?.id

    // Broadcast decline to driver — reuse existing subscription channel
    if (drId) {
      sendRiderBroadcast('rider_declined', { rideId })
    }

    // Mark counter-offering driver's request as ignored
    if (drId) {
      await supabase.from('ride_requests')
        .update({ status: 'ignored' })
        .eq('ride_id', rideId)
        .eq('driver_id', drId)
    }

    // Reset ride
    await supabase.from('rides').update({ status: 'searching', driver_id: null }).eq('id', rideId)
    setAcceptedDriver(null)

    // Check if other drivers still have pending requests
    const { data: stillPending } = await supabase.from('ride_requests')
      .select('id').eq('ride_id', rideId).eq('status', 'pending')

    if (stillPending && stillPending.length > 0) {
      // Other drivers may still respond
      setPhase('pending')
    } else {
      // Re-search with expanded radius
      searchingRef.current = false
      const { data: freshRide } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle()
      if (freshRide) await sendToNearbyDrivers(freshRide.pickup_lat, freshRide.pickup_lng, freshRide)
    }
  }

  async function retryWithPrice(extra: number) {
    const currentPrice = rideData?.price || 100000
    const newPrice = currentPrice + extra
    await supabase.from('rides').update({ price: newPrice, status: 'searching' }).eq('id', rideId)
    setRideData((p: any) => ({ ...p, price: newPrice }))
    searchingRef.current = false
    const { data: freshRide } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle()
    if (freshRide) await sendToNearbyDrivers(freshRide.pickup_lat, freshRide.pickup_lng, freshRide)
  }

  // While still searching, cancelling is free — no reason picker, no cancel counting.
  // (Those only kick in once a driver has been found — see tracking.tsx.)
  async function cancelRide() {
    cancelledRef.current = true
    navigatedRef.current = true
    await supabase.from('rides')
      .update({ status: 'cancelled', cancelled_by: 'rider' })
      .eq('id', rideId)
    router.replace('/' as never)
  }

  const vehicleIcon = acceptedDriver?.vehicle_type === 'Tuktuk' ? '🛺' : acceptedDriver?.vehicle_type === 'Car' ? '🚗' : '🏍'

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>

      {/* ── SEARCHING PHASE ── */}
      {phase === 'searching' && (
        <>
          <View style={[styles.searchCircle, { borderColor: '#F4B400' }]}>
            <ActivityIndicator size="large" color="#F4B400" />
          </View>
          <Text style={[styles.title, { color: textColor }]}>
            {ar ? 'جاري البحث عن سائق...' : 'Finding your driver...'}
          </Text>
          <Text style={[styles.subtitle, { color: subtextColor }]}>
            {ar ? `نطاق البحث: ${searchRadius} كم` : `Searching within ${searchRadius} km`}
          </Text>
          {/* Radius step indicators */}
          <View style={styles.stepsRow}>
            {RADIUS_STEPS.map((km, i) => (
              <View key={km} style={styles.stepItem}>
                <View style={[styles.stepDot, {
                  backgroundColor: i < searchStep ? '#16A34A' : i === searchStep ? '#F4B400' : (dark ? '#334155' : '#E5E7EB'),
                }]} />
                <Text style={[styles.stepLabel, { color: i <= searchStep ? '#F4B400' : subtextColor }]}>
                  {km} {ar ? 'كم' : 'km'}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.hint, { color: subtextColor }]}>
            {ar
              ? 'نوسّع نطاق البحث تلقائياً للعثور على سائق'
              : 'We automatically expand the search radius to find you a driver'}
          </Text>
          <Pressable onPress={cancelRide} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: subtextColor }]}>{ar ? 'إلغاء' : 'Cancel'}</Text>
          </Pressable>
        </>
      )}

      {/* ── PENDING PHASE ── */}
      {phase === 'pending' && (
        <>
          <View style={[styles.pendingCircle, { borderColor: dark ? '#334155' : '#E5E7EB' }]}>
            <ActivityIndicator size="large" color="#F4B400" />
          </View>
          <Text style={[styles.title, { color: textColor }]}>
            {ar ? 'في انتظار الرد...' : 'Waiting for response...'}
          </Text>
          <Text style={[styles.subtitle, { color: subtextColor }]}>
            {ar
              ? `تم إرسال الطلب إلى ${sentCount} سائق`
              : `Request sent to ${sentCount} driver${sentCount !== 1 ? 's' : ''}`}
          </Text>
          <Text style={[styles.hint, { color: subtextColor }]}>
            {ar ? 'سيتم إخطارك فور قبول أحد السائقين' : 'You\'ll be notified as soon as a driver accepts'}
          </Text>
          <Pressable onPress={cancelRide} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: subtextColor }]}>{ar ? 'إلغاء الطلب' : 'Cancel Request'}</Text>
          </Pressable>
        </>
      )}

      {/* ── ACCEPTED PHASE ── */}
      {phase === 'accepted' && (
        <>
          {acceptedDriver && (
            <Pressable
              onPress={() => router.push({ pathname: '/driver-profile/[id]', params: { id: acceptedDriver.id } } as never)}
              style={[styles.driverCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
              {acceptedDriver.driver_image
                ? <Image source={{ uri: acceptedDriver.driver_image }} style={styles.driverPhoto} />
                : <View style={[styles.driverPhotoPlaceholder, { backgroundColor: dark ? '#334155' : '#E5E7EB' }]}>
                    <Text style={{ fontSize: 36 }}>👤</Text>
                  </View>}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.driverName, { color: textColor }]}>{acceptedDriver.full_name}</Text>
                <Text style={{ color: '#16A34A', fontWeight: '700', fontSize: 13 }}>✅ {ar ? 'قبل طلبك!' : 'Accepted your request!'}</Text>
                <Text style={{ color: subtextColor, fontSize: 13 }}>{vehicleIcon} {acceptedDriver.vehicle_type}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: '#F4B400', fontSize: 14 }}>★</Text>
                  <Text style={{ color: subtextColor, fontSize: 13, fontWeight: '700' }}>{(acceptedDriver.rating || 5).toFixed(1)}</Text>
                </View>
              </View>
            </Pressable>
          )}
          <Text style={styles.emoji}>🎉</Text>
          <Text style={[styles.title, { color: textColor }]}>{ar ? 'تم قبول طلبك!' : 'Ride Accepted!'}</Text>
          <Text style={[styles.subtitle, { color: subtextColor }]}>{ar ? 'جارٍ الانتقال إلى التتبع...' : 'Taking you to tracking...'}</Text>
        </>
      )}

      {/* ── NO DRIVERS PHASE ── */}
      {phase === 'no_drivers' && (
        <>
          <Text style={styles.emoji}>😔</Text>
          <Text style={[styles.title, { color: textColor }]}>
            {ar ? 'لا يوجد سائقون متاحون' : 'No drivers available'}
          </Text>
          <Text style={[styles.subtitle, { color: subtextColor }]}>
            {ar
              ? 'ارفع السعر لجذب السائقين، أو حاول لاحقاً'
              : 'Raise your price to attract drivers, or try later'}
          </Text>
          <Text style={[styles.currentPrice, { color: '#F4B400' }]}>
            {ar ? 'عرضك الحالي:' : 'Your current offer:'} {(rideData?.price || 100000).toLocaleString()} {ar ? 'ل.ل' : 'L.L'}
          </Text>

          {/* Price retry buttons */}
          <View style={styles.retryBtns}>
            <Pressable onPress={() => retryWithPrice(50000)} style={[styles.priceRetryBtn, { backgroundColor: cardBg, borderColor: '#F4B400' }]}>
              <Text style={[styles.priceRetryAmount, { color: textColor }]}>+50,000 {ar ? 'ل.ل' : 'L.L'}</Text>
              <Text style={styles.priceRetryLabel}>{ar ? 'إعادة البحث' : 'Retry'}</Text>
            </Pressable>
            <Pressable onPress={() => retryWithPrice(100000)} style={[styles.priceRetryBtn, { backgroundColor: cardBg, borderColor: '#F4B400' }]}>
              <Text style={[styles.priceRetryAmount, { color: textColor }]}>+100,000 {ar ? 'ل.ل' : 'L.L'}</Text>
              <Text style={styles.priceRetryLabel}>{ar ? 'إعادة البحث' : 'Retry'}</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => { searchingRef.current = false; sendToNearbyDrivers(rideData?.pickup_lat, rideData?.pickup_lng, rideData) }} style={[styles.priceRetryBtn, { backgroundColor: dark ? '#1E293B' : '#F3F4F6', borderColor: cardBorder, width: '100%' }]}>
            <Text style={[{ color: textColor, fontWeight: '800', fontSize: 15 }]}>{ar ? '🔄 إعادة البحث بنفس السعر' : '🔄 Retry same price'}</Text>
          </Pressable>

          <Pressable onPress={cancelRide} style={[styles.cancelBtn, { marginTop: 4 }]}>
            <Text style={[styles.cancelText, { color: '#EF4444' }]}>{ar ? 'إلغاء الرحلة' : 'Cancel Ride'}</Text>
          </Pressable>
        </>
      )}

      {/* ── COUNTER OFFER MODAL ── */}
      <Modal visible={!!counterOffer} transparent animationType="slide">
        <View style={styles.counterOverlay}>
          <View style={[styles.counterCard, { backgroundColor: dark ? '#1E293B' : '#fff' }]}>

            {/* Driver who sent the offer */}
            {acceptedDriver && (
              <View style={styles.offerDriverRow}>
                {acceptedDriver.driver_image
                  ? <Image source={{ uri: acceptedDriver.driver_image }} style={styles.offerDriverPhoto} />
                  : <View style={[styles.offerDriverPhoto, { backgroundColor: '#F4B400', alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 20, fontWeight: '900', color: '#111827' }}>{acceptedDriver.full_name?.[0]}</Text>
                    </View>}
                <View>
                  <Text style={[{ fontSize: 16, fontWeight: '900', color: textColor }]}>{acceptedDriver.full_name}</Text>
                  <Text style={{ color: '#F4B400', fontSize: 12, fontWeight: '700' }}>
                    ★ {(acceptedDriver.rating || 5).toFixed(1)} · {vehicleIcon} {acceptedDriver.vehicle_type}
                  </Text>
                </View>
              </View>
            )}

            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 4 }}>💬</Text>
            <Text style={[styles.title, { color: textColor, marginBottom: 4 }]}>
              {ar ? 'السائق غيّر السعر' : 'Driver changed the price'}
            </Text>
            <Text style={styles.counterPrice}>{counterOffer?.price?.toLocaleString()} {ar ? 'ل.ل' : 'L.L'}</Text>

            {/* Countdown timer ring */}
            <View style={[styles.timerRing, { borderColor: counterTimer <= 3 ? '#EF4444' : '#F4B400' }]}>
              <Text style={[styles.timerText, { color: counterTimer <= 3 ? '#EF4444' : '#F4B400' }]}>{counterTimer}</Text>
            </View>
            <Text style={[styles.hint, { color: subtextColor, marginBottom: 20 }]}>
              {ar ? 'سيُرفض تلقائياً عند انتهاء الوقت' : 'Auto-rejects when timer ends'}
            </Text>

            <View style={styles.counterBtns}>
              <Pressable onPress={handleDeclineOffer} style={styles.counterDecline}>
                <Text style={styles.counterDeclineText}>{ar ? '❌ رفض' : '❌ Decline'}</Text>
              </Pressable>
              <Pressable onPress={handleAcceptOffer} style={styles.counterAccept}>
                <Text style={styles.counterAcceptText}>{ar ? '✅ قبول' : '✅ Accept'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },

  searchCircle: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  pendingCircle: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },

  stepsRow: { flexDirection: 'row', gap: 20, marginTop: 4 },
  stepItem: { alignItems: 'center', gap: 6 },
  stepDot: { width: 14, height: 14, borderRadius: 7 },
  stepLabel: { fontSize: 11, fontWeight: '700' },

  title: { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  hint: { fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  emoji: { fontSize: 64 },
  currentPrice: { fontSize: 18, fontWeight: '800' },

  driverCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 20, borderWidth: 1, padding: 16,
  },
  driverPhoto: { width: 68, height: 68, borderRadius: 34 },
  driverPhotoPlaceholder: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 17, fontWeight: '900' },

  retryBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  priceRetryBtn: {
    flex: 1, borderWidth: 1, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 4,
  },
  priceRetryAmount: { fontSize: 16, fontWeight: '900' },
  priceRetryLabel: { color: '#F4B400', fontSize: 12, fontWeight: '700' },

  cancelBtn: { padding: 14 },
  cancelText: { fontSize: 15, fontWeight: '600' },

  // Counter offer modal
  counterOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  counterCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 44, alignItems: 'center' },
  offerDriverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, alignSelf: 'flex-start' },
  offerDriverPhoto: { width: 48, height: 48, borderRadius: 24 },
  counterPrice: { fontSize: 38, fontWeight: '900', color: '#F4B400', marginBottom: 12 },
  timerRing: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  timerText: { fontSize: 22, fontWeight: '900' },
  counterBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  counterDecline: { flex: 1, backgroundColor: '#FEE2E2', borderRadius: 16, padding: 16, alignItems: 'center' },
  counterDeclineText: { color: '#EF4444', fontWeight: '800', fontSize: 15 },
  counterAccept: { flex: 1, backgroundColor: '#F4B400', borderRadius: 16, padding: 16, alignItems: 'center' },
  counterAcceptText: { color: '#111827', fontWeight: '900', fontSize: 15 },
})
