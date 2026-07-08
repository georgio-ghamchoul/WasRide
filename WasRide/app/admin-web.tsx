import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

export default function AdminWebScreen() {
  const { drivers } = useAppState();
  const [pendingDrivers, setPendingDrivers] = useState<any[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);

  const loadPendingDrivers = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'driver')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPendingDrivers(data || []);
    } catch (error) {
      Alert.alert("Error", "Could not load driver applications.");
    } finally {
      setLoadingApprovals(false);
    }
  }, []);

  useEffect(() => {
    void loadPendingDrivers();
  }, [loadPendingDrivers]);

  async function handleApproval(driverId: string, status: "approved" | "rejected") {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ approval_status: status })
        .eq('id', driverId);
      if (error) throw error;
      if (status === "rejected") {
        await supabase.from('driver_presence').update({ is_online: false }).eq('driver_id', driverId);
      }
      await loadPendingDrivers();
      Alert.alert("Done", status === "approved" ? "Driver approved!" : "Driver rejected.");
    } catch (error) {
      Alert.alert("Error", "Could not update the application.");
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#F9FAFB" }} contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: "900", color: "#111827" }}>
        🚕 Wasl Admin
      </Text>

      {/* Metrics */}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={metricCard}>
          <Text style={metricLabel}>Pending</Text>
          <Text style={[metricValue, { color: "#F59E0B" }]}>{pendingDrivers.length}</Text>
        </View>
        <View style={metricCard}>
          <Text style={metricLabel}>Online</Text>
          <Text style={[metricValue, { color: "#16A34A" }]}>
            {drivers.filter((d: any) => d.isOnline).length}
          </Text>
        </View>
      </View>

      {/* Pending Drivers */}
      <View style={panel}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={panelTitle}>Driver Applications</Text>
          <Pressable onPress={() => void loadPendingDrivers()}>
            <Text style={{ color: "#2563EB", fontWeight: "700", fontSize: 13 }}>
              {loadingApprovals ? "Loading..." : "Refresh"}
            </Text>
          </Pressable>
        </View>

        {pendingDrivers.length === 0 ? (
          <Text style={{ color: "#6B7280", fontSize: 14 }}>
            {loadingApprovals ? "Loading..." : "No pending applications"}
          </Text>
        ) : (
          pendingDrivers.map((driver) => (
            <View key={driver.id} style={driverRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#111827" }}>
                  {driver.full_name || "Unknown"}
                </Text>
                <Text style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>
                  📞 {driver.phone || "No phone"}
                </Text>
                <Text style={{ fontSize: 13, color: "#6B7280" }}>
                  {driver.vehicle_type === "Tuktuk" ? "🛺" : driver.vehicle_type === "Car" ? "🚗" : "🏍️"} {driver.vehicle_type || "Unknown vehicle"}
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                <Pressable onPress={() => void handleApproval(driver.id, "approved")}>
                  <View style={approveBtn}>
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>✓ Approve</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => void handleApproval(driver.id, "rejected")}>
                  <View style={rejectBtn}>
                    <Text style={{ color: "#DC2626", fontWeight: "800", fontSize: 13 }}>✕ Reject</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Driver Readiness */}
      <View style={panel}>
        <Text style={panelTitle}>Driver Readiness</Text>
        {drivers.length === 0 ? (
          <Text style={{ color: "#6B7280", fontSize: 14 }}>No drivers registered yet</Text>
        ) : (
          drivers.map((driver: any) => (
            <View key={driver.id} style={driverRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#111827" }}>{driver.name}</Text>
                <Text style={{ fontSize: 13, color: "#6B7280" }}>{driver.vehicle}</Text>
              </View>
              <View>
                <Text style={{ fontSize: 13, color: driver.isOnline ? "#16A34A" : "#9CA3AF", fontWeight: "700" }}>
                  {driver.isOnline ? "🟢 Online" : "⚫ Offline"}
                </Text>
                <Text style={{ fontSize: 13, color: "#6B7280" }}>⭐ {driver.rating?.toFixed(1)}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const metricCard = {
  flex: 1,
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 16,
  borderWidth: 1,
  borderColor: "#E5E7EB",
} as const;

const metricLabel = {
  fontSize: 13,
  color: "#6B7280",
  fontWeight: "700" as const,
  marginBottom: 4,
};

const metricValue = {
  fontSize: 32,
  fontWeight: "900" as const,
};

const panel = {
  backgroundColor: "#fff",
  borderRadius: 20,
  padding: 16,
  borderWidth: 1,
  borderColor: "#E5E7EB",
} as const;

const panelTitle = {
  fontSize: 18,
  fontWeight: "800" as const,
  color: "#111827",
};

const driverRow = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: "#F3F4F6",
};

const approveBtn = {
  backgroundColor: "#16A34A",
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 8,
  alignItems: "center" as const,
};

const rejectBtn = {
  backgroundColor: "#FEF2F2",
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 8,
  alignItems: "center" as const,
  borderWidth: 1,
  borderColor: "#FCA5A5",
};