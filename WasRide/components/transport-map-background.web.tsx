import { Text, View } from "react-native";

import { type Coordinate, type Driver } from "@/lib/app-state";

function MapPin({ label, color, kind }: { label: string; color: string; kind: "driver" | "user" }) {
  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          minWidth: 48,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#0F172A",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 18 }}>{kind === "driver" ? "🏍️" : "📍"}</Text>
      </View>
      <View
        style={{
          marginTop: 8,
          backgroundColor: "rgba(17,24,39,0.88)",
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>{label}</Text>
      </View>
    </View>
  );
}

export function TransportMapBackground({
  nearbyDrivers,
  showDrivers,
}: {
  userLocation: Coordinate;
  nearbyDrivers: Driver[];
  routeLine: Coordinate[];
  showDrivers: boolean;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: "#DCE8F7" }}>
      <View
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#DCE8F7",
        }}
      />
      <View
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.45,
          backgroundColor: "#C7D7EB",
        }}
      />
      <View style={{ position: "absolute", top: "52%", left: "48%" }}>
        <MapPin label="Passenger" color="#111827" kind="user" />
      </View>
      {showDrivers
        ? nearbyDrivers.map((driver, index) => (
            <View key={driver.id} style={{ position: "absolute", top: `${18 + index * 12}%`, left: `${20 + index * 18}%` }}>
              <MapPin label={`${driver.name} • ${driver.etaMinutes}m`} color={driver.accent} kind="driver" />
            </View>
          ))
        : null}
    </View>
  );
}
