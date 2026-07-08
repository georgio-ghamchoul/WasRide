# Rebel Taxi Launch Preparation

## Overview

The Android APK build has been intentionally excluded from this delivery. The launch-preparation work instead focuses on the operational items that are still valuable without a local build artifact: a **real-driver testing plan**, a **browser-oriented admin dashboard route**, and a short **go-live checklist** for the Rebel Taxi team.

The project now includes two admin experiences. The existing `/admin` route remains suitable for mobile review, while the new `/admin-web` route provides a more spacious browser layout for dispatch and support usage during testing and soft launch.

## Real-driver test plan

Before inviting production users, the team should validate the end-to-end ride cycle with a small group of real drivers and passengers. The goal is to confirm that approval, trip tracking, acceptance, completion, and rating behave correctly under realistic network and movement conditions.

| Test area | What to verify | Pass criteria |
|---|---|---|
| Driver onboarding | Driver applies, appears in admin approvals, and can only go online after approval | Driver stays blocked before approval and can go online after approval |
| Passenger booking | Passenger selects pickup and destination and creates a request | Request appears in the active flow without blocking errors |
| Driver acceptance | Driver opens the request and accepts it | Passenger receives the acceptance signal and tracking can start |
| Realtime movement | Driver and passenger maps update as the trip progresses | Both sides see map movement or updated locations during the active trip |
| Trip completion | Driver completes the trip | Passenger is sent to the rating flow |
| Rating | Passenger submits a star rating and optional feedback | Rating is stored in the request lifecycle without breaking navigation |
| Language preference | Arabic can be selected from profile | Core localized labels switch correctly on supported screens |
| Admin review | Admin can refresh approvals and manage driver status from mobile and browser layouts | Approval actions complete successfully and views remain usable |

## Soft-launch checklist

A short soft-launch window should be used before public release. During that period, the team should operate with a limited number of drivers, manually review approvals, and monitor notification delivery on physical devices.

| Launch item | Recommended action |
|---|---|
| Accounts | Seed at least one admin, two test drivers, and two rider accounts |
| Permissions | Confirm location and notification permissions on physical phones |
| Database | Apply the latest schema changes before field testing |
| Admin operations | Use `/admin-web` in a desktop browser during live testing |
| Support process | Keep one team member available to approve drivers and monitor request states |
| Rollback plan | If realtime or notifications fail, temporarily continue with manual driver coordination while fixing the issue |

## Admin web dashboard route

The new admin web dashboard is available at **`/admin-web`**. It is designed for larger screens and gives the operations team a clearer view of pending approvals, active requests, and driver readiness. This route is appropriate for browser-based dispatch review during testing, demos, and early launch.

## Recommended next steps

The next practical step is to run the real-driver test plan on physical devices connected to the same Supabase backend that will be used for launch. After that, the team should review any issues found in notification delivery, approval handling, or Arabic copy before preparing store-ready binaries.
