import { supabase } from "./supabase";
import type { Coordinate, DeliveryDraft, Driver, RideDraft, ServiceType } from "./app-state";

export type ProfileRole = "rider" | "driver" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ProfileRecord {
  id: string;
  phone: string | null;
  role: ProfileRole;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  vehicle_type: string | null;
  vehicle_label: string | null;
  approval_status: ApprovalStatus | null;
  average_rating: number | null;
  trips_completed: number | null;
  locale: string | null;
}

interface CoordinateInput {
  pickup?: Coordinate | null;
  destination?: Coordinate | null;
  rider?: Coordinate | null;
}

export async function getCurrentSupabaseUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }

  return data.user?.id ?? null;
}

export async function getMyProfile() {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    throw error;
  }

  return (data as ProfileRecord | null) ?? null;
}

export async function ensureProfile(
  role: ProfileRole,
  values?: Partial<ProfileRecord> & {
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    vehicle_type?: string | null;
    vehicle_label?: string | null;
    approval_status?: ApprovalStatus | null;
    locale?: string | null;
  },
) {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const payload = {
    id: userId,
    phone: values?.phone ?? null,
    role,
    first_name: values?.first_name ?? null,
    last_name: values?.last_name ?? null,
   full_name: (values?.full_name ?? [values?.first_name, values?.last_name].filter(Boolean).join(" ")) || null,
    vehicle_type: values?.vehicle_type ?? null,
    vehicle_label: values?.vehicle_label ?? null,
    approval_status: values?.approval_status ?? (role === "driver" ? "pending" : "approved"),
    locale: values?.locale ?? "en",
  };

  const { error } = await supabase.from("profiles").upsert(payload);
  if (error) {
    throw error;
  }

  return userId;
}

export async function updateMyProfile(values: {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
  vehicle_type?: string;
  vehicle_label?: string;
  locale?: string;
}) {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const payload = {
    ...values,
    full_name:
      (values.full_name ??
      [values.first_name, values.last_name]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(" ")) || null,
  };

  const { data, error } = await supabase.from("profiles").update(payload).eq("id", userId).select("*").single();
  if (error) {
    throw error;
  }

  return data as ProfileRecord;
}

export async function submitDriverApplication(values: {
  fullName: string;
  phone: string;
  vehicleType: string;
}) {
  return ensureProfile("driver", {
    full_name: values.fullName,
    phone: values.phone,
    vehicle_type: values.vehicleType,
    vehicle_label: values.vehicleType,
    approval_status: "pending",
  });
}

export async function listPendingDriverProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "driver")
    .in("approval_status", ["pending", "rejected"])
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as ProfileRecord[]) ?? [];
}

export async function updateDriverApproval(profileId: string, approvalStatus: ApprovalStatus) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ approval_status: approvalStatus })
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  if (approvalStatus !== "approved") {
    await supabase.from("driver_presence").upsert({
      driver_id: profileId,
      is_online: false,
    });
  }

  return data as ProfileRecord;
}

function buildCoordinatePayload(coordinates?: CoordinateInput) {
  return {
    pickup_latitude: coordinates?.pickup?.latitude ?? null,
    pickup_longitude: coordinates?.pickup?.longitude ?? null,
    destination_latitude: coordinates?.destination?.latitude ?? null,
    destination_longitude: coordinates?.destination?.longitude ?? null,
    rider_latitude: coordinates?.rider?.latitude ?? null,
    rider_longitude: coordinates?.rider?.longitude ?? null,
  };
}

export async function saveRideRequest(draft: RideDraft, interestedDriverIds: string[], coordinates?: CoordinateInput) {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("transport_requests")
    .insert({
      user_id: userId,
      service_type: "ride",
      pickup_label: draft.pickupLabel,
      destination_label: draft.destinationLabel,
      description: draft.notes,
      interested_driver_ids: interestedDriverIds,
      ...buildCoordinatePayload(coordinates),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

export async function saveDeliveryRequest(draft: DeliveryDraft, interestedDriverIds: string[], coordinates?: CoordinateInput) {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("transport_requests")
    .insert({
      user_id: userId,
      service_type: "delivery",
      delivery_kind: draft.deliveryKind,
      pickup_label: draft.deliveryKind === "from-store" ? draft.storeName || draft.pickupLabel : draft.pickupLabel,
      destination_label: draft.dropoffLabel,
      description: draft.description,
      receiver_phone: draft.receiverPhone,
      interested_driver_ids: interestedDriverIds,
      ...buildCoordinatePayload(coordinates),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

export async function updateTransportRequestStatus(values: {
  requestId: string;
  status: "matching" | "driver-selected" | "tracking" | "completed" | "cancelled";
  selectedDriverId?: string | null;
}) {
  const payload: Record<string, unknown> = {
    status: values.status,
  };

  if (values.selectedDriverId !== undefined) {
    payload.selected_driver_id = values.selectedDriverId;
  }

  if (values.status === "completed") {
    payload.completed_at = new Date().toISOString();
  }

  const { error } = await supabase.from("transport_requests").update(payload).eq("id", values.requestId);
  if (error) {
    throw error;
  }

  return true;
}

export async function saveTripRating(values: { requestId: string; rating: number; feedback?: string }) {
  const { error } = await supabase
    .from("transport_requests")
    .update({
      rider_rating: values.rating,
      rider_feedback: values.feedback ?? null,
    })
    .eq("id", values.requestId);

  if (error) {
    throw error;
  }

  return true;
}

export async function updateDriverPresence(driver: Driver, isOnline: boolean) {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const { error } = await supabase.from("driver_presence").upsert({
    driver_id: userId,
    is_online: isOnline,
    latitude: driver.coordinate.latitude,
    longitude: driver.coordinate.longitude,
    heading: driver.heading,
    vehicle_label: driver.vehicle,
  });

  if (error) {
    throw error;
  }

  return true;
}

export async function loadNearbyPresence(service: ServiceType) {
  const { data, error } = await supabase
    .from("driver_presence")
    .select("driver_id, is_online, latitude, longitude, heading, vehicle_label, updated_at")
    .eq("is_online", true)
    .order("updated_at", { ascending: false })
    .limit(service === "ride" ? 8 : 12);

  if (error) {
    throw error;
  }

  return data;
}

export async function loadLatestActiveRequest() {
  const userId = await getCurrentSupabaseUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("transport_requests")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["matching", "driver-selected", "tracking", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}
