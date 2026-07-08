import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Wasl Ride",
  slug: "rebel-taxi-mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "rebeltaxi",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.rebeltaxi.app",
    infoPlist: {
      NSLocationWhenInUseUsageDescription: "Wasl needs your location to find nearby drivers and track your ride.",
      NSLocationAlwaysAndWhenInUseUsageDescription: "Wasl needs your location in the background to track your ride.",
      NSLocationAlwaysUsageDescription: "Wasl needs your location in the background to track your ride.",
      NSCameraUsageDescription: "Wasl needs camera access to take profile pictures.",
      NSPhotoLibraryUsageDescription: "Wasl needs photo library access to upload profile pictures.",
      NSPhotoLibraryAddUsageDescription: "Wasl needs permission to save photos.",
      NSMicrophoneUsageDescription: "Wasl needs microphone access for in-app calls with your driver.",
      UIBackgroundModes: ["location", "fetch"],
    },
    // iOS uses Apple Maps (PROVIDER_DEFAULT) — no Google Maps key required.
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/icon.png",
      backgroundColor: "#0B1F44",
    },
    package: "com.rebeltaxi.app",
    // Firebase config for FCM push notifications (Android). Ships in the app.
    googleServicesFile: "./google-services.json",
    permissions: [
      "POST_NOTIFICATIONS",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
    ],
    config: {
      googleMaps: {
        // Android uses Google Maps. Key is read from .env (gitignored) so it
        // never lands in git. Set GOOGLE_MAPS_ANDROID_KEY in your .env file.
        apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
      },
    },
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    // Sentry crash/error monitoring. Errors report with just this plugin; to also
    // upload source maps (readable stack traces) set organization/project here plus
    // a SENTRY_AUTH_TOKEN env var at EAS build time.
    "@sentry/react-native",
    // Agora — wires microphone permissions and native module linkage in EAS builds.
    // Remove this entry if you are not doing an EAS build, otherwise pnpm install will warn.
    // ["react-native-agora"],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#0B1F44",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: "Wasl needs your location to find nearby drivers and track your ride.",
        locationWhenInUsePermission: "Wasl needs your location to find nearby drivers and track your ride.",
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Wasl needs access to your photos to upload profile pictures.",
        cameraPermission: "Wasl needs access to your camera to take profile pictures.",
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    eas: {
      projectId: "d32fbe4c-ceac-4bc8-b3b2-247cd0dba874",
    },
  },
};

export default config;