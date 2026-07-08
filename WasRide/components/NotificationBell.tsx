// Bell icon + unread badge. Refreshes on focus AND live via Supabase realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { countUnread, onInboxRead } from "@/lib/inbox";

export default function NotificationBell({ color = "#111827" }: { color?: string }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const userIdRef = useRef<string | null>(null);
  const roleRef = useRef<string>("rider");

  const recompute = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    const n = await countUnread(uid, roleRef.current);
    setCount(n);
  }, []);

  const refresh = useCallback(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      userIdRef.current = user.id;
      const { data: prof } = await supabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      roleRef.current = prof?.role || "rider";
      const n = await countUnread(user.id, roleRef.current);
      if (active) setCount(n);
    })();
    return () => { active = false; };
  }, []);

  // Recompute every time the screen regains focus (e.g. after viewing the inbox).
  useFocusEffect(refresh);

  // Clear the badge instantly the moment the inbox is marked read.
  useEffect(() => onInboxRead(() => setCount(0)), []);

  // Live: bump the badge the moment a new notification row arrives.
  useEffect(() => {
    // Unique channel name per mount — a fixed name makes Supabase return the
    // already-subscribed channel, and calling .on() after subscribe() throws.
    const channel = supabase
      .channel(`inbox-bell-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as any;
        const uid = userIdRef.current;
        if (!uid) return;
        // Only react to rows this user can actually see (their own or broadcasts).
        const role = roleRef.current;
        const isMine = n.user_id === uid;
        const isBroadcast =
          !n.user_id &&
          (n.audience === "all" ||
            (n.audience === "drivers" && role === "driver") ||
            (n.audience === "riders" && role === "rider"));
        if (isMine || isBroadcast) recompute();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [recompute]);

  return (
    <Pressable onPress={() => router.push("/notifications" as never)} style={styles.btn} hitSlop={10}>
      <Ionicons name="notifications-outline" size={22} color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  bell: { fontSize: 22 },
  badge: {
    position: "absolute", top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
