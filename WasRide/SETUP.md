# Rebel Taxi Setup Guide

## What has already been prepared

The mobile app now includes a redesigned map-first rider experience, a driver mode with online visibility, a phone login screen backed by Supabase, request storage helpers, a simple admin dashboard screen, realtime-ready state handling, and a custom brand icon.

## What you still need to do in Supabase

First, open your Supabase project and enable **Phone Auth** in the authentication settings. You must also configure your SMS provider inside Supabase so OTP codes can actually be delivered to real phone numbers.

Next, open the SQL editor in Supabase and run the contents of `supabase/schema.sql`. This creates the `profiles`, `transport_requests`, and `driver_presence` tables and adds row-level security policies.

## Environment variables

The project uses these public Expo variables:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Connects the app to your Supabase project |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Allows the mobile client to authenticate and read/write permitted data |

These variables are already configured in the workspace, but if you change Supabase projects later, update them in project settings.

## Main app routes

| Route | Purpose |
|---|---|
| `/` | Rider home screen with map, nearby drivers, and entry to ride or delivery flows |
| `/ride` | Ride request form |
| `/delivery` | Delivery type selection |
| `/request-sent` | Matching screen with driver response timer |
| `/driver-list` | Manual driver choice list |
| `/tracking` | Rider tracking screen |
| `/driver/home` | Driver map and online mode |
| `/login` | Phone OTP login with Supabase |
| `/admin` | Simple admin dashboard |

## Notes about the current implementation

The app is already structured to save requests to Supabase and update driver presence. If the required tables do not exist yet, the UI still works locally so you can preview the full flow before completing backend setup.

The current realtime behavior is partly demo-driven in local state and partly ready for Supabase presence data. Once your backend tables are live and populated, you can extend the subscription layer further for fully synchronized rider-driver updates.

## How to test

Start the project normally and open it in Expo Go or the web preview. Test the rider flow first, then open driver mode, go online, and verify the driver becomes visible in the matching flow. After Supabase phone auth and SQL setup are complete, test the login flow with a real phone number and OTP.
