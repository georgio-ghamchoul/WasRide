# App Store / Play Store — Reviewer Notes

Paste the relevant section into the "Notes for Review" / "App access" field when
submitting. These explain *why* the app uses sensitive permissions, which is what
reviewers (especially Apple) look for.

---

## Demo account for review

Reviewers cannot complete sign-up because the app uses phone (SMS OTP) login.
Provide a working test account so they can get past the login screen:

- Rider test phone: __________  (set up a number you can receive the code on, or
  a Supabase test user)
- Driver test phone: __________  (pre-approved driver, so the driver flow is visible)
- If using Supabase test OTP, give the fixed code here: __________

> Tip: in Supabase Auth you can add a test phone number with a fixed OTP so the
> reviewer never needs a real SIM.

---

## Location usage justification

**Why the app needs location (Always / When In Use):**

Wasl Ride is a ride-hailing app that connects riders with nearby drivers in a local
town. Location is essential to the core function:

- **Riders** — to show nearby drivers, set the pickup point, and follow the
  driver's position during an active trip.
- **Drivers** — to share their live position with the matched rider while a trip
  is in progress, so the rider can see the car approaching and en route.

**Why background location is requested (drivers only):**

A driver's phone is often locked or showing navigation while driving. The app
updates the driver's location in the background **only during an active, accepted
trip** so the rider's tracking screen stays accurate. Background location is **not**
collected when the driver is offline or has no active trip. Riders do not use
background location.

This maps to the Info.plist strings already in the app:
- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `UIBackgroundModes: ["location"]`

**How a reviewer can see it:** sign in as the driver test account, accept a ride
request, and the tracking/location sharing begins. (You may need a second device
or the rider account to create a request.)

---

## Other permissions

- **Camera / Photo Library** — used only to set or change a profile picture.
- **Microphone** — used only for optional in-app voice calls between a rider and
  their matched driver during a trip.
- **Notifications** — ride status updates, chat messages, and account messages.

---

## Payments

The app does **not** process any in-app or electronic payments. All fares are paid
in **cash** directly between rider and driver. There is no payment SDK, no in-app
purchase, and no financial data collected. (Mention this to avoid IAP-related
review questions.)

---

## Required links

- Privacy Policy URL: __________  (host legal/privacy-policy.html)
- Terms of Service URL: __________  (host legal/terms-of-service.html)
- Support email: georgiogh88@gmail.com
