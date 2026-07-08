import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

export default function RideHistoryScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const cardBg = darkMode ? '#1F2937' : '#F9FAFB';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');

  useEffect(() => { loadRides(); }, []);

  async function loadRides() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('rides')
      .select('*, drivers(full_name, driver_image, vehicle_type, rating)')
      .eq('passenger_id', user.id)
      .order('created_at', { ascending: false });

    setRides(data || []);
    setLoading(false);
  }

  const filtered = filter === 'all' ? rides : rides.filter(r => r.status === filter);

  function formatDate(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString(ar ? 'ar-LB' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function statusStyle(status: string) {
    if (status === 'completed') return { bg: darkMode ? '#14532D' : '#DCFCE7', text: '#16A34A' };
    if (status === 'cancelled') return { bg: darkMode ? '#450a0a' : '#FEE2E2', text: '#EF4444' };
    return { bg: darkMode ? '#1F2937' : '#F3F4F6', text: subtextColor };
  }

  function statusLabel(status: string) {
    if (status === 'completed') return ar ? 'مكتملة' : 'Completed';
    if (status === 'cancelled') return ar ? 'ملغاة' : 'Cancelled';
    return ar ? 'جارية' : 'Ongoing';
  }

  const filters: { key: 'all' | 'completed' | 'cancelled'; label: string }[] = [
    { key: 'all', label: ar ? 'الكل' : 'All' },
    { key: 'completed', label: ar ? 'مكتملة' : 'Completed' },
    { key: 'cancelled', label: ar ? 'ملغاة' : 'Cancelled' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>

      {/* HEADER */}
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <Pressable onPress={() => router.back()}>
          <Text style={[styles.back, { color: textColor }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: textColor }]}>
          {ar ? 'سجل الرحلات' : 'Ride History'}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {/* FILTER TABS */}
      <View style={[styles.filterRow, { borderBottomColor: borderColor }]}>
        {filters.map(f => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={{ flex: 1 }}>
            <View style={[
              styles.filterTab,
              filter === f.key && { borderBottomWidth: 2, borderBottomColor: '#F4B400' },
            ]}>
              <Text style={[
                styles.filterText,
                { color: filter === f.key ? '#F4B400' : subtextColor },
              ]}>
                {f.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* LIST */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#F4B400" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontSize: 52 }}>🏍️</Text>
          <Text style={{ color: subtextColor, fontSize: 16, fontWeight: '600' }}>
            {ar ? 'لا توجد رحلات بعد' : 'No rides yet'}
          </Text>
          <Pressable onPress={() => router.replace('/' as never)}>
            <View style={styles.bookBtn}>
              <Text style={styles.bookBtnText}>{ar ? 'احجز رحلة الآن' : 'Book a ride now'}</Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => {
            const s = statusStyle(item.status);
            const driver = item.drivers;
            return (
              <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>

                {/* TOP ROW — date + status */}
                <View style={styles.cardTop}>
                  <Text style={[styles.cardDate, { color: subtextColor }]}>
                    {formatDate(item.created_at)}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                    <Text style={[styles.statusText, { color: s.text }]}>
                      {statusLabel(item.status)}
                    </Text>
                  </View>
                </View>

                {/* ROUTE */}
                <View style={styles.routeBlock}>
                  <View style={styles.routeRow}>
                    <View style={[styles.dot, { backgroundColor: '#16A34A' }]} />
                    <Text style={[styles.routeText, { color: textColor }]} numberOfLines={1}>
                      {ar ? 'نقطة الاستلام' : 'Pickup'}
                    </Text>
                  </View>
                  <View style={[styles.routeLine, { backgroundColor: borderColor }]} />
                  <View style={styles.routeRow}>
                    <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
                    <Text style={[styles.routeText, { color: textColor }]} numberOfLines={1}>
                      {ar ? 'الوجهة' : 'Destination'}
                    </Text>
                  </View>
                </View>

                {/* BOTTOM ROW — driver + price */}
                <View style={[styles.cardBottom, { borderTopColor: borderColor }]}>
                  <View style={styles.driverInfo}>
                    <Text style={{ fontSize: 16 }}>🏍️</Text>
                    <View>
                      <Text style={[styles.driverName, { color: textColor }]}>
                        {driver?.full_name || (ar ? 'سائق' : 'Driver')}
                      </Text>
                      {driver?.rating && (
                        <Text style={{ color: subtextColor, fontSize: 12 }}>⭐ {driver.rating}</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.price, { color: textColor }]}>
                      💵 {item.price ? `${item.price.toLocaleString()} ل.ل` : (ar ? 'غير محدد' : 'N/A')}
                    </Text>
                    <Text style={[styles.serviceType, { color: subtextColor }]}>
                      {item.service === 'couriers' ? (ar ? 'توصيل' : 'Delivery') : (ar ? 'موتو' : 'Moto')}
                    </Text>
                  </View>
                </View>

              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1,
  },
  back: { fontSize: 36, fontWeight: '300', lineHeight: 40 },
  title: { fontSize: 20, fontWeight: '900' },
  filterRow: { flexDirection: 'row', borderBottomWidth: 1 },
  filterTab: { paddingVertical: 14, alignItems: 'center' },
  filterText: { fontSize: 14, fontWeight: '700' },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 12, fontWeight: '600' },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '800' },
  routeBlock: { gap: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, height: 10, marginLeft: 4 },
  routeText: { fontSize: 14, fontWeight: '600', flex: 1 },
  cardBottom: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingTop: 12, borderTopWidth: 1,
  },
  driverInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  driverName: { fontSize: 14, fontWeight: '700' },
  price: { fontSize: 15, fontWeight: '800' },
  serviceType: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  bookBtn: { backgroundColor: '#F4B400', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  bookBtnText: { color: '#111827', fontWeight: '900', fontSize: 15 },
});
