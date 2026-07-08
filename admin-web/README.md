# Rebel Taxi — Admin Web Panel

A standalone desktop admin dashboard for the Rebel Taxi app. It talks to the same
Supabase project as the mobile app, so everything stays in sync. **Admin only** —
no rider or driver features.

## What it does

- **Dashboard** — live counts (pending drivers, drivers online, active/completed/cancelled rides, riders, today/week revenue).
- **Drivers** — filter by status, search, and Approve / Suspend / Ban / Reactivate.
- **Rides** — view Active (last 6h) / Completed / Cancelled, and Clear (permanently delete) a list.
- **Earnings** — per-driver totals, commission and payout by vehicle type, plus Clear earnings.
- **Notify** — broadcast an in-app notification to Everyone / Drivers / Riders.

## Run it on your PC

You need [Node.js](https://nodejs.org) (v18 or newer) installed.

```bash
cd admin-web
npm install
npm run dev
```

Then open the URL it prints (default http://localhost:5180).

> If `npm install` complains about a leftover `node_modules` folder, delete the
> `admin-web/node_modules` folder in File Explorer first, then run it again.

### Build a static version (optional, for hosting)

```bash
npm run build      # outputs to admin-web/dist
npm run preview    # serves the built version locally
```

You can host the `dist/` folder on any static host (Netlify, Vercel, Cloudflare Pages, etc.).

## Logging in

Sign in with the **admin phone number** (the one ending in `71073230`). You'll get
an SMS code, exactly like the mobile app. Any other number is rejected.

## Security notes

- The app uses your Supabase **publishable (anon) key** — safe to ship to a browser.
- All admin powers (deleting rides, sending broadcasts, changing driver status) are
  enforced server-side by Supabase Row Level Security via the `is_admin()` check
  (`profiles.role = 'admin'`). The web page can't do anything the policies don't allow.
- Never put the Supabase **service-role** key in this project.

## Config

Credentials live in `.env`:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

These already match your mobile app's Supabase project.
