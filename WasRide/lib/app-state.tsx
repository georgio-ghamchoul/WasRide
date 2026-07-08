import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import * as Location from "expo-location";
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ensureProfile,
  loadNearbyPresence,
  saveDeliveryRequest,
  saveRideRequest,
  saveTripRating,
  updateDriverPresence,
  updateTransportRequestStatus,
} from "@/lib/transport-backend";

export type ServiceType = "ride" | "delivery";
export type AppRole = "rider" | "driver";
export type DeliveryKind = "from-home" | "from-store";
export type RequestStage = "draft" | "matching" | "driver-selected" | "tracking" | "completed";
export type LocaleCode = "en" | "ar";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  rating: number;
  etaMinutes: number;
  distanceKm: number;
  isOnline: boolean;
  coordinate: Coordinate;
  heading: number;
  accent: string;
}

export interface RideDraft {
  pickupLabel: string;
  destinationLabel: string;
  notes: string;
}

export interface DeliveryDraft {
  deliveryKind: DeliveryKind;
  pickupLabel: string;
  dropoffLabel: string;
  description: string;
  receiverPhone: string;
  storeName: string;
}

export interface ActiveRequest {
  id: string;
  remoteId?: string | null;
  service: ServiceType;
  stage: RequestStage;
  pickupLabel: string;
  destinationLabel: string;
  description: string;
  receiverPhone?: string;
  interestedDriverIds: string[];
  selectedDriverId?: string;
  pickupCoordinate: Coordinate;
  destinationCoordinate: Coordinate;
  riderCoordinate: Coordinate;
  createdAt: string;
  riderRating?: number;
  riderFeedback?: string;
  riderId?: string;
}

interface AppStateValue {
  isAdmin: boolean;
  setIsAdmin: (val: boolean) => void;
  role: AppRole;
  setRole: (role: AppRole) => void;
  preferredService: ServiceType;
  setPreferredService: (service: ServiceType) => void;
  userLocation: Coordinate;
  setUserLocation: (location: Coordinate) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  drivers: Driver[];
  setDrivers: (updater: Driver[] | ((current: Driver[]) => Driver[])) => void;
  rideDraft: RideDraft;
  setRideDraft: (draft: RideDraft) => void;
  deliveryDraft: DeliveryDraft;
  setDeliveryDraft: (draft: DeliveryDraft) => void;
  activeRequest: ActiveRequest | null;
  driverOnline: boolean;
  setDriverOnline: (value: boolean) => void;
  submitRide: (draft: RideDraft) => ActiveRequest;
  submitDelivery: (draft: DeliveryDraft) => ActiveRequest;
  expressInterest: (driverId: string) => void;
  chooseDriver: (driverId: string) => void;
  startTracking: () => void;
  completeTrip: () => void;
  submitTripRating: (rating: number, feedback: string) => void;
  resetFlow: () => void;
  selectedDriver: Driver | null;
  nearbyDrivers: Driver[];
  updateDriverCoordinate: (driverId: string, coordinate: Coordinate, heading?: number) => void;
}

const baseLocation: Coordinate = {
  latitude: 34.4367,
  longitude: 35.8497,
};

// Start with no drivers — the map shows only real online drivers from the database.
const initialDrivers: Driver[] = [];

const defaultRideDraft: RideDraft = {
  pickupLabel: "Current location",
  destinationLabel: "Tripoli center",
  notes: "",
};

const defaultDeliveryDraft: DeliveryDraft = {
  deliveryKind: "from-home",
  pickupLabel: "Current location",
  dropoffLabel: "Mina district",
  description: "Documents package",
  receiverPhone: "+961 70 000 000",
  storeName: "",
};

const AppStateContext = createContext<AppStateValue | null>(null);

function buildRequestId() {
  return `req-${Date.now()}`;
}

function midpoint(from: Coordinate, to: Coordinate): Coordinate {
  return {
    latitude: (from.latitude + to.latitude) / 2,
    longitude: (from.longitude + to.longitude) / 2,
  };
}

export function AppStateProvider({ children }: PropsWithChildren) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<AppRole>("rider");
  const [preferredService, setPreferredService] = useState<ServiceType>("ride");
  const [userLocation, setUserLocation] = useState<Coordinate>(baseLocation);
  const [locale, setLocaleState] = useState<LocaleCode>("en");
  const [darkMode, setDarkModeState] = useState(false);
  const [drivers, setDriversState] = useState<Driver[]>(initialDrivers);
  const [rideDraft, setRideDraft] = useState<RideDraft>(defaultRideDraft);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryDraft>(defaultDeliveryDraft);
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [driverOnline, setDriverOnline] = useState(false);

  const setDrivers = useCallback((updater: Driver[] | ((current: Driver[]) => Driver[])) => {
    setDriversState((current) => (typeof updater === "function" ? updater(current) : updater));
  }, []);

  // Load persisted settings
  useEffect(() => {
    AsyncStorage.getItem('language').then((lang) => {
      if (lang === 'ar' || lang === 'en') setLocaleState(lang as LocaleCode);
    });
    AsyncStorage.getItem('darkMode').then((val) => {
      if (val === 'true') setDarkModeState(true);
    });
    AsyncStorage.getItem('isAdmin').then((val) => {
      if (val === 'true') setIsAdmin(true);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") return;

        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted) return;

        const currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        setUserLocation(currentLocation);
        setRideDraft((current) => ({ ...current, pickupLabel: current.pickupLabel || "Current location" }));
        setDeliveryDraft((current) => ({ ...current, pickupLabel: current.pickupLabel || "Current location" }));
      } catch {
        // Keep the seeded fallback when location is unavailable.
      }
    };

    void loadLocation();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncPresence = async () => {
      try {
        const rows = await loadNearbyPresence(preferredService);
        if (cancelled) return;

        // Replace driver list entirely with whatever is online right now.
        // An empty result (no drivers online) clears the map correctly.
        const remoteDrivers = (rows ?? []).slice(0, 3).map((row, index) => ({
          id: String(row.driver_id),
          name: `Live driver ${index + 1}`,
          vehicle: row.vehicle_label || "Vehicle",
          rating: 4.7,
          etaMinutes: 3 + index * 2,
          distanceKm: 0.8 + index * 0.4,
          isOnline: Boolean(row.is_online),
          coordinate: {
            latitude: typeof row.latitude === "number" ? row.latitude : baseLocation.latitude,
            longitude: typeof row.longitude === "number" ? row.longitude : baseLocation.longitude,
          },
          heading: typeof row.heading === "number" ? row.heading : 0,
          accent: ["#F4B400", "#16A34A", "#2563EB"][index] || "#111827",
        }));

        setDrivers(remoteDrivers);
      } catch {
        // Keep the current driver list when backend is temporarily unreachable.
      }
    };

    void syncPresence();
    // Poll every 15 seconds so offline drivers disappear from the map promptly.
    const interval = setInterval(syncPresence, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [preferredService, setDrivers]);

  const nearbyDrivers = useMemo(() => drivers.filter((driver) => driver.isOnline), [drivers]);

  const selectedDriver = useMemo(() => {
    if (!activeRequest?.selectedDriverId) return null;
    return drivers.find((driver) => driver.id === activeRequest.selectedDriverId) ?? null;
  }, [activeRequest?.selectedDriverId, drivers]);

  const submitRide = useCallback(
    (draft: RideDraft) => {
      const requestId = buildRequestId();
      const destinationCoordinate = midpoint(userLocation, nearbyDrivers[0]?.coordinate ?? baseLocation);
      const request: ActiveRequest = {
        riderId: "rider-1", // temporary (later from auth)
        id: requestId,
        remoteId: null,
        service: "ride",
        stage: "matching",
        pickupLabel: draft.pickupLabel,
        destinationLabel: draft.destinationLabel,
        description: draft.notes || "Standard ride request",
        interestedDriverIds: nearbyDrivers.slice(0, 3).map((driver) => driver.id),
        pickupCoordinate: userLocation,
        destinationCoordinate,
        riderCoordinate: userLocation,
        createdAt: new Date().toISOString(),
      };

      setPreferredService("ride");
      setRideDraft(draft);
      setActiveRequest(request);

      void saveRideRequest(draft, request.interestedDriverIds, {
        pickup: request.pickupCoordinate,
        destination: request.destinationCoordinate,
        rider: request.riderCoordinate,
      })
        .then((remoteId) => {
          if (!remoteId) return;
          setActiveRequest((current) => (current?.id === requestId ? { ...current, remoteId } : current));
        })
        .catch(() => {});

      return request;
    },
    [nearbyDrivers, userLocation],
  );

  const submitDelivery = useCallback(
    (draft: DeliveryDraft) => {
      const requestId = buildRequestId();
      const destinationCoordinate = midpoint(userLocation, nearbyDrivers[0]?.coordinate ?? baseLocation);
      const request: ActiveRequest = {
        riderId: "rider-1", // temporary (later from auth)
        id: requestId,
        remoteId: null,
        service: "delivery",
        stage: "matching",
        pickupLabel: draft.deliveryKind === "from-store" ? draft.storeName || draft.pickupLabel : draft.pickupLabel,
        destinationLabel: draft.dropoffLabel,
        description: draft.description,
        receiverPhone: draft.receiverPhone,
        interestedDriverIds: nearbyDrivers.slice(0, 3).map((driver) => driver.id),
        pickupCoordinate: userLocation,
        destinationCoordinate,
        riderCoordinate: userLocation,
        createdAt: new Date().toISOString(),
      };

      setPreferredService("delivery");
      setDeliveryDraft(draft);
      setActiveRequest(request);

      void saveDeliveryRequest(draft, request.interestedDriverIds, {
        pickup: request.pickupCoordinate,
        destination: request.destinationCoordinate,
        rider: request.riderCoordinate,
      })
        .then((remoteId) => {
          if (!remoteId) return;
          setActiveRequest((current) => (current?.id === requestId ? { ...current, remoteId } : current));
        })
        .catch(() => {});

      return request;
    },
    [nearbyDrivers, userLocation],
  );

  const expressInterest = useCallback((driverId: string) => {
    setActiveRequest((current) => {
      if (!current || current.interestedDriverIds.includes(driverId)) return current;
      return { ...current, interestedDriverIds: [...current.interestedDriverIds, driverId] };
    });
  }, []);

  const chooseDriver = useCallback((driverId: string) => {
    setActiveRequest((current) => {
      if (!current) return current;
      const nextRequest = { ...current, selectedDriverId: driverId, stage: "driver-selected" as const };
      if (current.remoteId) {
        void updateTransportRequestStatus({
          requestId: current.remoteId,
          status: "driver-selected",
          selectedDriverId: driverId,
        }).catch(() => {});
      }
      return nextRequest;
    });
  }, []);

  const startTracking = useCallback(() => {
    setActiveRequest((current) => {
      if (!current) return current;
      if (current.remoteId) {
        void updateTransportRequestStatus({
          requestId: current.remoteId,
          status: "tracking",
          selectedDriverId: current.selectedDriverId,
        }).catch(() => {});
      }
      return { ...current, stage: "tracking" };
    });
  }, []);

  const completeTrip = useCallback(() => {
    setActiveRequest((current) => {
      if (!current) return current;
      if (current.remoteId) {
        void updateTransportRequestStatus({
          requestId: current.remoteId,
          status: "completed",
          selectedDriverId: current.selectedDriverId,
        }).catch(() => {});
      }
      return { ...current, stage: "completed" };
    });
  }, []);

  const submitTripRating = useCallback((rating: number, feedback: string) => {
    setActiveRequest((current) => {
      if (!current) return current;
      if (current.remoteId) {
        void saveTripRating({ requestId: current.remoteId, rating, feedback }).catch(() => {});
      }
      return { ...current, riderRating: rating, riderFeedback: feedback };
    });

    setDrivers((current) =>
      current.map((driver) => {
        if (driver.id !== activeRequest?.selectedDriverId) return driver;
        return { ...driver, rating: Number(((driver.rating + rating) / 2).toFixed(1)) };
      }),
    );
  }, [activeRequest?.selectedDriverId, setDrivers]);

  const resetFlow = useCallback(() => {
    setActiveRequest(null);
    setPreferredService("ride");
    setRideDraft(defaultRideDraft);
    setDeliveryDraft(defaultDeliveryDraft);
  }, []);

  const setDriverOnlineState = useCallback(
    (value: boolean) => {
      setDriverOnline(value);
      setDrivers((current) => {
        const nextDrivers = current.map((driver, index) =>
          index === 0
            ? {
                ...driver,
                name: "You",
                vehicle: driver.vehicle || "Motorbike",
                isOnline: value,
                coordinate: userLocation,
                accent: value ? "#16A34A" : "#9CA3AF",
              }
            : driver,
        );

        const currentDriver = nextDrivers[0];
        if (currentDriver) {
          void ensureProfile("driver", {
            full_name: currentDriver.name,
            vehicle_label: currentDriver.vehicle,
            approval_status: "approved",
          })
            .then(() => updateDriverPresence(currentDriver, value))
            .catch(() => {});
        }

        return nextDrivers;
      });
    },
    [setDrivers, userLocation],
  );

  const updateDriverCoordinate = useCallback(
    (driverId: string, coordinate: Coordinate, heading = 0) => {
      setDrivers((current) =>
        current.map((driver) =>
          driver.id === driverId ? { ...driver, coordinate, heading } : driver,
        ),
      );

      setActiveRequest((current) => {
        if (!current || current.selectedDriverId !== driverId) return current;
        return { ...current, riderCoordinate: current.riderCoordinate };
      });
    },
    [setDrivers],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      isAdmin,
      setIsAdmin: (val: boolean) => {
        setIsAdmin(val);
        void AsyncStorage.setItem('isAdmin', String(val));
      },
      role,
      setRole,
      preferredService,
      setPreferredService,
      userLocation,
      setUserLocation,
      locale,
      setLocale: (lang: LocaleCode) => {
        setLocaleState(lang);
        void AsyncStorage.setItem('language', lang);
      },
      darkMode,
      setDarkMode: (val: boolean) => {
        setDarkModeState(val);
        void AsyncStorage.setItem('darkMode', String(val));
      },
      drivers,
      setDrivers,
      rideDraft,
      setRideDraft,
      deliveryDraft,
      setDeliveryDraft,
      activeRequest,
      driverOnline,
      setDriverOnline: setDriverOnlineState,
      submitRide,
      submitDelivery,
      expressInterest,
      chooseDriver,
      startTracking,
      completeTrip,
      submitTripRating,
      resetFlow,
      selectedDriver,
      nearbyDrivers,
      updateDriverCoordinate,
    }),
    [
      isAdmin,
      activeRequest,
      chooseDriver,
      completeTrip,
      darkMode,
      deliveryDraft,
      driverOnline,
      drivers,
      expressInterest,
      nearbyDrivers,
      preferredService,
      resetFlow,
      rideDraft,
      role,
      selectedDriver,
      setDriverOnlineState,
      setDrivers,
      startTracking,
      submitDelivery,
      submitRide,
      submitTripRating,
      updateDriverCoordinate,
      userLocation,
      locale,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside AppStateProvider");
  }
  return context;
}