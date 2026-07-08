# Wasl Ride 🚕

A full-stack ride-hailing mobile app for riders and drivers, built as a solo project.
Live at [waslride.com](https://waslride.com).

## Tech Stack

- **Frontend:** React Native (Expo), TypeScript, Expo Router (file-based routing), NativeWind
- **Maps:** Google Maps on Android, Apple Maps on iOS (`react-native-maps`)
- **Backend:** Supabase — Postgres database, Auth, Storage, Realtime, and Edge Functions
- **Auth:** Phone login via WhatsApp OTP (delivered through Supabase Edge Functions)
- **Realtime:** Supabase Realtime channels for live ride and driver-presence updates
- **Notifications:** Expo push notifications
- **Data/state:** React Query, Reanimated for animations

## Features

- 🗺️ Map-first rider exp