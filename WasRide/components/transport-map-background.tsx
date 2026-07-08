import { useEffect, useMemo, useRef } from "react";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";

import { type Coordinate, type Driver } from "@/lib/app-state";

function MapPin({ label, color, kind }: { label: string; color: string; kind: "driver" | "user" }) {
  return (
    <>
      <MapMarkerContent label={label} color={color} kind={kind} />
    </>
  );
}

function MapMarkerContent({ label, color, kind }: { label: string; color: string; kind: "driver" | "user" }) {
  const { View, Text } = require("react-native") as typeof import("react-native");

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
  userLocation,
  nearbyDrivers,
  routeLine,
  showDrivers,
}: {
  userLocation: Coordinate;
  nearbyDrivers: Driver[];
  routeLine: Coordinate[];
  showDrivers: boolean;
}) {
  const mapRef = useRef<MapView>(null);

  const focusPoints = useMemo(() => {
    const points = [userLocation, ...routeLine];
    return points.filter(
      (point, index, all) =>
        index === all.findIndex((candidate) => candidate.latitude === point.latitude && candidate.longitude === point.longitude),
    );
  }, [routeLine, userLocation]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (focusPoints.length > 1) {
      mapRef.current.fitToCoordinates(focusPoints, {
        edgePadding: { top: 180, right: 80, bottom: 260, left: 80 },
        animated: true,
      });
      return;
    }

    mapRef.current.animateToRegion(
      {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      600,
    );
  }, [focusPoints, userLocation]);

  return (
    <MapView
      ref={mapRef}
      style={{ flex: 1 }}
      provider={PROVIDER_GOOGLE}
      showsUserLocation={false}
      showsCompass={false}
      showsMyLocationButton={false}
      initialRegion={{
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      }}
    >
      <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 1 }}>
        <MapPin label="Passenger" color="#111827" kind="user" />
      </Marker>

      {showDrivers
        ? nearbyDrivers.map((driver) => (
            <Marker key={driver.id} coordinate={driver.coordinate} anchor={{ x: 0.5, y: 1 }} rotation={driver.heading}>
              <MapPin label={`${driver.name} • ${driver.etaMinutes}m`} color={driver.accent} kind="driver" />
            </Marker>
          ))
        : null}

      {routeLine.length > 1 ? <Polyline coordinates={routeLine} strokeColor="#2563EB" strokeWidth={5} /> : null}
    </MapView>
  );
}
