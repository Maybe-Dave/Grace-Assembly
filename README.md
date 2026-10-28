# Grace Assembly — Church Attendance App

A Progressive Web App (PWA) for managing attendance at **Grace Assembly**, a ~250-member Nigerian church.

> **Phase 3: Attendance Screen**  
> Complete implementation of the attendance screen at `/attendance`. Includes service header, live debounced search by name/phone with privacy-preserving phone masking (`search_people_for_service` RPC), initials circles, unit tags, circular brass toggles with optimistic UI updates, and sticky bottom live progress bar.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Design System](#design-system)
- [Attendance Screen (Phase 3)](#attendance-screen-phase-3)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Database Migrations](#database-migrations)
- [Role Model & Staff Sign-in](#role-model--staff-sign-in)
- [Seeding Staff Members](#seeding-staff-members)
- [PWA Verification](#pwa-verification)
- [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 + Bespoke Grace Assembly Design System |
| Typography | Fraunces 700 & Work Sans 400/500/600 (Google Fonts) |
| Database & Auth | Supabase (Postgres + Email OTP Auth) |
| PWA | Custom service worker + Web App Manifest |
| Hosting | Vercel |
| Package Manager | npm |

---

## Design System

The app follows a curated aesthetic inspired by architectural church heritage:

### Color Palette
- `#F7F3EC` — Background (warm plaster)
- `#1F2A24` — Primary text (deep forest-charcoal)
- `#6B4226` — Borders / dividers (wood brown)
- `#A8763E` — Primary accent — buttons & attendance checks ("brass" moment)
- `#4C6B52` — Secondary accent — links, initials badges, secondary actions (sage green)
- `#C94F3D` — Alerts / errors only (muted brick red)

### Typography
- **Headings**: Fraunces, weight 700 (solid display serif)
- **Body / UI**: Work Sans, weights 400, 500, 600

---

## Attendance Screen (Phase 3)

The attendance screen is located at `/attendance`:

1. **Header (Lighter surface, bottom border)**:
   - Service name: Fraunces bold 21px (e.g. `Sunday Service`)
   - Date and time subtitle: `13px` muted text (e.g. `Sunday, 8 Nov • 9:00 AM`)
   - Chevron icon on the right (visual indicator for future multi-service switching)
2. **Search Input**:
   - Search bar with magnifying glass icon and placeholder `"Search by name or phone"`
   - Debounced (250ms) search calling `search_people_for_service` RPC
3. **Pill Buttons**:
   - `"Family check-in"` and `"New visitor"` side-by-side pill buttons (visual only in Phase 3)
4. **Member List**:
   - Each row displays:
     - Initials circle with sage-tinted background (`#4C6B52/15`)
     - Full name (`16px font-medium #1F2A24`)
     - Unit tag pill (e.g. Choir, Ushers, Youth, FWI, Men's Fellowship, Children)
     - **Phone numbers are never shown anywhere on screen**
5. **Circular Toggles**:
   - Unmarked: Outlined circle (`border-2 border-[#6B4226]/40`)
   - Marked present: Filled brass circle (`#A8763E`) with a crisp white checkmark
   - **Optimistic UI**: Instant state flip and bottom-bar recalculation with automatic rollback on network failure
6. **Sticky Bottom Bar**:
   - `"[X] of [Y] marked present • [Z]%"`
   - Smooth brass progress bar updating in real time

---

## Local Setup

### Prerequisites

- Node.js 18+ (`node --version`)
- npm 9+
- A [Supabase](https://supabase.com) project

### Steps

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd grace-assembly

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 4. Run database migrations in your Supabase project (see below)

# 5. Start dev server
npm run dev
```

---

## Database Migrations

Migrations live in `supabase/migrations/`:

```
001_schema.sql              → creates core tables (units, people, services, attendance, pending_members)
002_seed.sql                → seeds 6 ministry units + initial Sunday service
003_roles_rls.sql           → creates staff_roles table + RLS policies + people_view
005_add_email_to_people.sql → adds email column to people table and updates people_view
006_search_people_rpc.sql   → creates search_people_for_service RPC with phone masking
```

### Running Migrations via Supabase Dashboard SQL Editor
1. Open **Supabase Dashboard → SQL Editor**
2. Paste each file's contents in order (`001`, `002`, `003`, `005`, `006`) and click **Run**.

---

## Role Model & Staff Sign-in

1. **Staff Email OTP**: Sign-in on `/` uses Supabase 8-digit email OTP.
2. **Pre-flight Check**: Rejects unregistered emails before sending any code.
3. **Attendance Entry**: Authenticated staff (admin or usher role) land directly on `/attendance`.
4. **Session Guard**: Direct unauthenticated access to `/attendance` automatically redirects to `/`.

---

## Seeding Staff Members

To register a staff member so they can sign in:

```bash
# Register an admin
npm run seed:staff -- "David Dickson" "dicksondave2002@gmail.com" "+2348000000001" "admin"

# Register an usher
npm run seed:staff -- "Sister Sarah" "sarah@graceassembly.org" "+2348000000002" "usher"
```

---

## Cleaning Up Test Data Before Pilot

For testing the attendance directory in Phase 3, 12 fictional members across 6 ministry units were seeded.

To purge these test records and their attendance entries before the December pilot without touching real church members:

```bash
npm run cleanup:test-members
```

This runs [`scripts/cleanup-test-members.mjs`](file:///c:/Users/WHITESYSTEM/Desktop/Personal/Church_App/grace-assembly/scripts/cleanup-test-members.mjs), which safely deletes the 12 test records and their attendance history while preserving all real church members and staff accounts.
