# Grace Assembly — Church Attendance App

A Progressive Web App (PWA) for managing attendance at **Grace Assembly**, a ~250-member Nigerian church.

> **Phase 1** — Project skeleton only. This phase sets up the database, environment, and a health-check page. No sign-in UI, no attendance forms, no member management yet.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Database Migrations](#database-migrations)
- [Role Model](#role-model)
- [PWA Verification](#pwa-verification)
- [Deployment (Vercel)](#deployment-vercel)
- [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), TypeScript |
| Styling | Tailwind CSS 4 |
| Database & Auth | Supabase (Postgres + GoTrue) |
| PWA | Custom service worker + Web App Manifest |
| Hosting | Vercel |
| Package Manager | npm |

---

## Local Setup

### Prerequisites

- Node.js 18+ (`node --version`)
- npm 9+
- A [Supabase](https://supabase.com) project (free tier is fine)

### Steps

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd grace-assembly

# 2. Install dependencies
npm install

# 3. Copy the example env file and fill in your values
cp .env.example .env.local
# Edit .env.local — see "Environment Variables" below

# 4. Run the database migrations (see "Database Migrations" below)

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the health-check page.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the three values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Find these values in your Supabase dashboard under:  
**Project Settings → API → Project URL / API Keys**

> ⚠️ **Never commit `.env.local`**. The `.gitignore` already excludes it.  
> ✅ **Do commit `.env.example`** — it documents which variables are needed (with no real values).

### Vercel

Set the same three variables in **Vercel → Project → Settings → Environment Variables**.

---

## Running Locally

```bash
npm run dev      # Development server with hot reload (http://localhost:3000)
npm run build    # Production build (only needed before deploy)
npm run start    # Serve production build locally
npm run lint     # ESLint check
```

---

## Database Migrations

Migrations live in `supabase/migrations/` and are plain SQL files. Run them in order against your Supabase project.

### Option A — Supabase Dashboard SQL Editor

1. Open **Supabase Dashboard → SQL Editor**
2. Run each file in order:

```
001_schema.sql       → creates all tables
002_seed.sql         → inserts 6 units + 1 service
003_roles_rls.sql    → creates staff_roles table + RLS policies
```

Paste each file's contents into the editor and click **Run**.

### Option B — Supabase CLI (recommended for CI/CD)

```bash
# Install the CLI (once)
npm install -g supabase

# Link to your project
supabase login
supabase link --project-ref <your-project-ref>

# Push all migrations
supabase db push
```

### Verifying the Seed Data

After running migrations, confirm in the SQL editor:

```sql
select * from units;          -- should return 6 rows
select * from services;       -- should return 1 row (next Sunday, 09:00)
```

---

## Role Model

**We use a dedicated `staff_roles` table** (not JWT custom claims).

### Why `staff_roles` over custom claims?

| Concern | `staff_roles` table | JWT custom claims |
|---------|--------------------|--------------------|
| Update a user's role | `UPDATE staff_roles SET role = 'admin' WHERE user_id = ?` | Requires an Edge Function or Auth Hook |
| No extra infrastructure | ✅ Just SQL | ❌ Needs hook or function deployment |
| Queryable in RLS policies | ✅ Via `select role from staff_roles where user_id = auth.uid()` | Needs `auth.jwt() ->> 'role'` and claim must be fresh |
| Realtime role changes | ✅ Immediate (next query reads new role) | ❌ Token must expire/refresh before changes take effect |
| Future expansion | ✅ Can add columns (unit_id, granted_by, etc.) | ❌ Claims are unstructured JSON |

### Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full read/write on all tables |
| `usher` | Read/write `people` (phone column hidden) and `attendance`; can submit `pending_members` but cannot approve them |

### How phone is hidden from ushers

Postgres RLS cannot redact individual columns — it can only include or exclude rows.  
To hide `phone` from ushers, we provide a **`people_view`** view:

```sql
create view people_view as
select
  id, full_name,
  case when current_user_role() = 'admin' then phone else null end as phone,
  unit_id, household_id, status, created_at
from people;
```

**Ushers must always query `people_view`**, not `people` directly. The direct `people` table is locked to admins only via RLS. This is enforced at the DB level — not just hidden in the UI.

### Adding a user to a role

After a user signs up via Supabase Auth:

```sql
-- Make a user an admin
insert into staff_roles (user_id, role) values ('<user-uuid>', 'admin');

-- Make a user an usher
insert into staff_roles (user_id, role) values ('<user-uuid>', 'usher');
```

### Testing usher phone-column restriction

```sql
-- 1. Sign in as the usher user in Supabase Auth
-- 2. Use the usher's JWT in the Authorization header, or test via:
select * from people_view;
-- The `phone` column should be NULL for all rows when queried as an usher.
-- If you query `people` directly as an usher, you'll get 0 rows (RLS blocks it).
```

---

## PWA Verification

### Manifest
1. Open Chrome DevTools → **Application** tab → **Manifest**
2. You should see "Grace Assembly" listed as the app name with icons

### Service Worker
1. DevTools → **Application** → **Service Workers**
2. `/sw.js` should appear with status **"Activated and running"**
3. The `Cache Storage` section (same Application tab) should show `grace-assembly-v1`

### Install prompt (Android / Desktop Chrome)
- Android Chrome: a "Add to Home Screen" banner should appear
- Desktop Chrome: an install icon (⊕) appears in the address bar
- After install, the app opens in standalone mode (no browser chrome)

---

## Deployment (Vercel)

1. Push the repo to GitHub
2. In Vercel, click **Add New Project** → import the repo
3. Set these environment variables in **Settings → Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy — the health-check page at `/` should show the real unit count from Supabase

---

## Project Structure

```
grace-assembly/
├── public/
│   ├── manifest.json           # PWA Web App Manifest
│   ├── sw.js                   # Service Worker (network-first + cache fallback)
│   └── icons/
│       ├── icon-192x192.png    # PWA icon (Android home screen)
│       └── icon-512x512.png    # PWA icon (splash screen)
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (manifest link, PWA meta tags)
│   │   ├── globals.css         # Global styles + Tailwind import
│   │   └── page.tsx            # Health-check page (/)
│   ├── components/
│   │   └── PWARegister.tsx     # Client component: registers /sw.js
│   └── lib/
│       └── supabase/
│           ├── client.ts       # Browser Supabase client (anon key)
│           └── admin.ts        # Server-only admin client (service role key)
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql      # Core tables: units, people, services, attendance, pending_members
│       ├── 002_seed.sql        # Seed data: 6 units + 1 service
│       └── 003_roles_rls.sql   # staff_roles table + RLS policies + people_view
├── .env.example                # Template for environment variables (committed)
├── .env.local                  # Real env vars — NOT committed (gitignored)
├── next.config.ts
├── tsconfig.json
└── README.md
```
