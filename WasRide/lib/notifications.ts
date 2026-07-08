import Constants from "expo-constants";
import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { supabase } from "@/lib/supabase";

// expo-notifications is not fully supported in Expo Go — skip it entirely.
const _inExpoGo = isRunningInExpoGo();

type NotificationsModule = typeof import("expo-notifications");
const N: NotificationsModule | null = _inExpoGo
  ? null
  : require("expo-notifications");

if (N) {
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!N) return null;

  if (Platform.OS === "android") {
    await N.setNotificationChannelAsync("default", {
      name: "default",
      importance: N.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#F4B400",
    });
  }

  const { status: existingStatus } = await N.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await N.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;
  if (!projectId) return null;

  const token = await N.getExpoPushTokenAsync({ projectId });
  return token.data;
}

// Register for push and save the resulting token to the user's profile row,
// so the admin broadcast screen can reach this device. Safe to call repeatedly;
// it no-ops in Expo Go or if permission is denied.
export async function syncPushTokenToProfile(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await supabase.from("profiles").update({ expo_push_token: token }).eq("id", userId);
  } catch (e) {
    console.log("syncPushTokenToProfile error:", e);
  }
}

export async function sendLocalRideRequestNotification() {
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: "New Wasl request",
      body: "A passenger is waiting for a nearby driver to respond.",
      sound: true,
      data: { type: "ride_request" },
    },
    trigger: null,
  });
}

export async function sendLocalDriverAcceptedNotification(driverName: string) {
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: "Driver accepted your request",
      body: `${driverName} is on the way to your pickup point.`,
      sound: true,
      data: { type: "driver_accepted" },
    },
    trigger: null,
  });
}

export async function sendLocalDriverArrivedNotification(driverName?: string) {
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: "📍 Driver has arrived!",
      body: driverName
        ? `${driverName} is waiting at your pickup point.`
        : "Your driver is waiting at the pickup point.",
      sound: true,
      data: { type: "driver_arrived" },
    },
    trigger: null,
  });
}

export async function sendLocalChatMessageNotification(senderName: string, message: string) {
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: `💬 ${senderName}`,
      body: message,
      sound: true,
      data: { type: "chat_message" },
    },
    trigger: null,
  });
}

export async function sendLocalTripStartedNotification(driverName?: string) {
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: "🚀 Trip Started!",
      body: driverName
        ? `Your trip with ${driverName} has started. Enjoy the ride!`
        : "Your trip has started. Enjoy the ride!",
      sound: true,
      data: { type: "trip_started" },
    },
    trigger: null,
  });
}
