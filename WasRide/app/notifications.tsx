import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";
import { fetchInbox, markInboxRead, type InboxItem, type NotifType } from "@/lib/inbox";

const ICONS: Record<NotifType, string> = {
  admin: "📣",
  ride: "🚗",
  ban: "🚫",
  chat: "💬",
  system: "🔔",
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === "ar";

  const bg = darkMode ? "#0F172A" : "#fff";
  const cardBg = darkMode ? "#1E293B" : "#F9FAFB";
  const textColor = darkMode ? "#F1F5F9" : "#111827";
  const subColor = darkMode ? "#94A3B8" : "#6B7280";
  const border = darkMode ? "#334155" : "#E5E7EB";

  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = prof?.role || "rider";
    const inbox = await fetchInbox(user.id, role);
    setItems(inbox);
    setLoading(false);
    setRefreshing(false);
    markInboxRead(user.id).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return ar ? "الآن" : "now";
    if (m < 60) return ar ? `قبل ${m} د` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return ar ? `قبل ${h} س` : `${h}h ago`;
    const d = Math.floor(h / 24);
    return ar ? `قبل ${d} ي` : `${d}d ago`;
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { borderBottomColor: border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor }]}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          {ar ? "الإشعارات" : "Notifications"}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#F4B400" /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#F4B400" />
          }
          ListEmptyComponent={
            <View style={[styles.center, { marginTop: 80 }]}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🔔</Text>
              <Text style={{ color: subColor, fontSize: 15, fontWeight: "600" }}>
                {ar ? "لا توجد إشعارات بعد" : "No notifications yet"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={styles.icon}>{ICONS[item.type] || "🔔"}</Text>
              <View style={{ flex: 1 }}>
                {item.title ? (
                  <Text style={[styles.title, { color: textColor }]}>{item.title}</Text>
                ) : null}
                <Text style={[styles.body, { color: textColor }]}>{item.body}</Text>
                <Text style={[styles.time, { color: subColor }]}>{timeAgo(item.created_at)}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 32, alignItems: "flex-start" },
  backText: { fontSize: 34, fontWeight: "300", lineHeight: 36 },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  center: { alignItems: "center", justifyContent: "center", flex: 1 },
  card: { flexDirection: "row", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "flex-start" },
  icon: { fontSize: 22 },
  title: { fontSize: 15, fontWeight: "800", marginBottom: 2 },
  body: { fontSize: 14, fontWeight: "500", lineHeight: 19 },
  time: { fontSize: 11, fontWeight: "600", marginTop: 6 },
});
