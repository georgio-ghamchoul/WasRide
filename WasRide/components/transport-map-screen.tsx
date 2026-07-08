import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { TransportMapBackground } from "@/components/transport-map-background";
import { useAppState, type Driver } from "@/lib/app-state";

function DriverChip({ driver }: { driver: Driver }) {
  return (
    <View
      style={{
        backgroundColor: "rgba(255,255,255,0.92)",
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginRight: 12,
        minWidth: 144,
        shadowColor: "#0F172A",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: "800", color: "#111827" }}>{driver.name}</Text>
      <Text style={{ marginTop: 4, fontSize: 12, color: "#4B5563" }}>
        {driver.etaMinutes} min away • {driver.vehicle}
      </Text>
    </View>
  );
}

export function TransportMapScreen({
  title,
  subtitle,
  actionLabel,
  actionHref,
  secondaryLabel,
  secondaryHref,
  children,
  showDrivers = true,
  showPolyline = false,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  children: ReactNode;
  showDrivers?: boolean;
  showPolyline?: boolean;
}) {
  const router = useRouter();
  const { userLocation, nearbyDrivers, selectedDriver, activeRequest } = useAppState();

  const riderCoordinate = activeRequest?.riderCoordinate ?? userLocation;

  const routeLine = useMemo(() => {
    if (!showPolyline || !selectedDriver) {
      return [];
    }

    return [selectedDriver.coordinate, riderCoordinate];
  }, [riderCoordinate, selectedDriver, showPolyline]);

  return (
    <View style={{ flex: 1, backgroundColor: "#DCE8F7" }}>
      <TransportMapBackground userLocation={riderCoordinate} nearbyDrivers={nearbyDrivers} routeLine={routeLine} showDrivers={showDrivers} />

      <SafeAreaView edges={["top", "left", "right"]} style={{ position: "absolute", inset: 0 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(15,23,42,0.84)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700", letterSpacing: 0.8 }}>WASL</Text>
            </View>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
              <View style={{ backgroundColor: "rgba(255,255,255,0.96)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 }}>
                <Text style={{ color: "#111827", fontSize: 13, fontWeight: "700" }}>Back</Text>
              </View>
            </Pressable>
          </View>

          <View style={{ backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 28, paddingHorizontal: 18, paddingVertical: 18 }}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: "#111827" }}>{title}</Text>
            <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: "#4B5563" }}>{subtitle}</Text>
            {activeRequest ? (
              <Text style={{ marginTop: 10, fontSize: 12, color: "#2563EB", fontWeight: "700" }}>
                {activeRequest.service === "ride" ? "Ride" : "Delivery"} flow in progress
              </Text>
            ) : null}
          </View>

          {showDrivers ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
              {nearbyDrivers.map((driver) => (
                <DriverChip key={driver.id} driver={driver} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom", "left", "right"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <View
          style={{
            marginHorizontal: 14,
            marginBottom: 8,
            borderRadius: 30,
            backgroundColor: "rgba(248,250,252,0.97)",
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 18,
            shadowColor: "#0F172A",
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 6,
          }}
        >
          {children}
          {(actionLabel && actionHref) || (secondaryLabel && secondaryHref) ? (
            <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
              {secondaryLabel && secondaryHref ? (
                <Pressable onPress={() => router.push(secondaryHref as never)} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.86 : 1 }]}>
                  <View
                    style={{
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: "#D7DEE7",
                      backgroundColor: "#FFFFFF",
                      paddingVertical: 16,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#111827", fontWeight: "800" }}>{secondaryLabel}</Text>
                  </View>
                </Pressable>
              ) : null}

              {actionLabel && actionHref ? (
                <Pressable
                  onPress={() => router.push(actionHref as never)}
                  style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
                >
                  <View
                    style={{
                      borderRadius: 18,
                      backgroundColor: "#111827",
                      paddingVertical: 16,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>{actionLabel}</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}
