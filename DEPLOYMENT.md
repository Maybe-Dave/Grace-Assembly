# Grace Assembly — Production Deployment Guide

This guide details the exact manual steps required before and after deploying Grace Assembly to Vercel and connecting it to Supabase.

> [!IMPORTANT]
> **Complete Steps 1, 2, and 3 BEFORE the first production user attempts to sign in.**
> If users attempt to sign in or request staff access before these steps are completed, magic link/OTP delivery will redirect improperly, and intake/staff approvals will fail.

---

## 1. Apply Supabase Database Migrations

You must run migrations `008` and `009` in your **Supabase Dashboard → SQL Editor** against your production database.

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
     * Creates the `pending_staff_requests` table with public submission RLS and Pastor/Secretary review policies.

*(Note: Migration `007` has already been applied, but `007`, `008`, and `009` are idempotent and safe to re-run).*

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
- [ ] **Staff Approvals:** Sign in as Pastor or Secretary and verify `/staff-approvals` shows pending requests and allows approving volunteers into sections.
- [ ] **Intake Approvals:** Sign in as Head Usher and verify `/approvals` lists visitor intakes with duplicate phone flags.
- [ ] **Section Attendance:** Sign in as an Usher and verify `/attendance` marks attendance for their assigned section, with offline persistence and sync indicator.
- [ ] **Executive Dashboard:** Sign in as Admin, Pastor, or Secretary and verify `/dashboard` displays live turnout and historical trend curves.
