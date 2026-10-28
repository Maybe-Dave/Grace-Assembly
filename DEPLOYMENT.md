# Grace Assembly — Production Deployment Guide

This guide details the exact manual steps required before and after deploying Grace Assembly to Vercel and connecting it to Supabase.

> [!IMPORTANT]
> **Complete Steps 1, 2, and 3 BEFORE the first production user attempts to sign in.**
> If users attempt to sign in or request staff access before these steps are completed, magic link/OTP delivery will redirect improperly, and intake/staff approvals will fail.

---

## 1. Apply Supabase Database Migrations

You must run migrations `008`, `009`, `010`, and `011` in your **Supabase Dashboard → SQL Editor** against your production database.

### Files to Run:

1. **Migration 008 (Pending People Intake Queue & Head Usher Role):**
   * **Local file:** [`supabase/migrations/008_pending_people_and_intake.sql`](file:///c:/Users/WHITESYSTEM/Desktop/Personal/Church_App/grace-assembly/supabase/migrations/008_pending_people_and_intake.sql)
   * **What it does:**
     * Expands `staff_roles` constraint to support `'head_usher'`, `'pastor'`, `'secretary'`.
     * Creates the `pending_people` intake queue table with RLS policies.
     * Installs the `check_phone_duplicate` RPC for prefix-normalized (+234 / 0) phone matching.

2. **Migration 009 (Pending Staff Requests & Onboarding):**
   * **Local file:** [`supabase/migrations/009_pending_staff_requests.sql`](file:///c:/Users/WHITESYSTEM/Desktop/Personal/Church_App/grace-assembly/supabase/migrations/009_pending_staff_requests.sql)
   * **What it does:**
     * Creates the `pending_staff_requests` table with public submission RLS.

3. **Migration 010 (Two-Tier Roles & Positions Schema Migration):**
   * **Local file:** [`supabase/migrations/010_two_tier_roles_and_positions.sql`](file:///c:/Users/WHITESYSTEM/Desktop/Personal/Church_App/grace-assembly/supabase/migrations/010_two_tier_roles_and_positions.sql)
   * **What it does:**
     * Adds `positions text[] DEFAULT '{}'::text[]` to `people` table with GIN index.
     * Backfills pastor/secretary staff into `people.positions` before remapping.
     * Replaces old role check constraint with: `super_admin`, `attendance_admin`, `attendance_staff`, `finance_admin`, `finance_staff`, `events_admin`, `events_staff` (or `NULL`).
     * Remaps existing rows: `admin` → `super_admin`, `head_usher` → `attendance_admin`, `usher` → `attendance_staff`, `pastor`/`secretary` → `NULL`.
     * Restricts `pending_staff_requests` management exclusively to `super_admin`.
     * Upgrades `search_people_for_service` RPC to support searching by position tag.

4. **Migration 011 (Service Session Lifecycle Status):**
   * **Local file:** [`supabase/migrations/011_service_session_status.sql`](file:///c:/Users/WHITESYSTEM/Desktop/Personal/Church_App/grace-assembly/supabase/migrations/011_service_session_status.sql)
   * **What it does:**
     * Adds `status text NOT NULL DEFAULT 'closed' CHECK (status IN ('active', 'closed'))` to `services` table.
     * Adds index `idx_services_status` for high-performance lookup of active service sessions.
     * Marks latest Sunday service as `'active'` while ensuring all previous services are marked `'closed'`.

---

## 2. Configure Vercel Environment Variables

Go to your **Vercel Project Dashboard → Settings → Environment Variables** and add the following 3 variables for **Production**, **Preview**, and **Development**:

| Variable Name | Value Source | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API | Your Supabase project URL (`https://xvnussqofsdyffypiulp.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API | Supabase anon/publishable key (`sb_publishable_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API | Supabase secret service role key (`sb_secret_...`) |

> [!WARNING]
> **DO NOT** set `NEXT_PUBLIC_ENABLE_DEV_LOGIN` in Vercel.  
> Leaving this variable unset (or `false`) ensures the "Development Quick Access" toolbar and bypass logic are completely disabled and omitted from the production build.

---

## 3. Configure Supabase Auth URLs

Go to **Supabase Dashboard → Authentication → URL Configuration**:

1. **Site URL:**
   Set to your live Vercel production domain:
   ```text
   https://your-production-app.vercel.app
   ```
2. **Redirect URLs:**
   Add your domain wildcards and local development fallback:
   ```text
   https://your-production-app.vercel.app/**
   http://localhost:3000/**
   ```

*(Without these redirect URLs, magic link OTP emails generated in production will fail to redirect users back into the app).*

---

## 4. Verification Checklist After First Deploy

Once Vercel finishes deploying:

- [ ] **Sign-In Page:** Visit `https://your-production-app.vercel.app/` — verify the "Development Quick Access" toolbar at the bottom is **gone**.
- [ ] **Request Staff Access:** Click "Request staff access →", submit a volunteer request, and verify the confirmation screen renders.
- [ ] **Staff Approvals:** Sign in as `super_admin` ONLY and verify `/staff-approvals` shows pending requests. Verify domain admins get 403 Forbidden.
- [ ] **Intake Approvals:** Sign in as `attendance_admin` or `super_admin` and verify `/approvals` lists visitor intakes with duplicate phone flags.
- [ ] **Section Attendance:** Sign in as `attendance_staff` and verify `/attendance` marks attendance for their assigned section.
- [ ] **Executive Dashboard:** Sign in as `super_admin` or `attendance_admin` and verify `/dashboard` displays live turnout and historical trend curves.
- [ ] **Former Pastor/Secretary Accounts:** Verify accounts with `role = NULL` receive 403 Forbidden across all protected management routes until explicitly assigned a new system role.
