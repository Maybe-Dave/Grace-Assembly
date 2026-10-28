# Grace Assembly — Complete Application Overview & Walkthrough Guide

This document is a comprehensive walkthrough guide of the **Grace Assembly** church management platform. It covers everything built in the application: its design philosophy, permission model, architecture, user flows, and a step-by-step walkthrough script for live demonstrations.

---

## 1. Executive Summary & Philosophy

**Grace Assembly** is an offline-resilient, role-gated church operations platform designed specifically for Sunday services and church administration. 

### Core Problems Solved
1. **Concurrent Mid-Service Ushers**: Multiple ushers simultaneously take attendance across independent physical rooms without collision or overriding each other's counts.
2. **Offline Tolerance**: Church auditoriums often suffer from poor cellular connectivity. Attendance toggles work offline instantly using IndexedDB and automatically sync when connectivity is restored.
3. **Visitor Intake Without Directory Pollution**: First-time attendees and visitors collected during service do not bypass leadership into the member roster; they are queued for Head Usher/Admin verification with automated duplicate detection.
4. **Decoupled Roles & Positions**: Church titles ("Senior Pastor", "Head Usher", "Secretary") are preserved as descriptive leadership tags, while software permissions are strictly governed by functional security roles.
5. **Multi-Device Responsive Shell**: From an usher on a mobile phone walking aisles to a pastor on an iPad or church administrator on a MacBook, layouts adapt intelligently with real breakpoints.

---

## 2. Two-Tier Permission Model

The platform uses a clean two-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    TWO-TIER PERMISSION MODEL                │
├──────────────────────────────┬──────────────────────────────┤
│  TIER 1: ROLES               │  TIER 2: POSITIONS & UNITS   │
│  (Software Permissions)      │  (Descriptive Tags / Roster) │
├──────────────────────────────┼──────────────────────────────┤
│ • super_admin                │ • "Senior Pastor"            │
│ • attendance_admin           │ • "Associate Pastor"         │
│ • attendance_staff           │ • "Church Secretary"         │
│ • finance_admin / staff      │ • "Head Usher"               │
│ • events_admin / staff       │ • "Choir Leader"             │
│ • NULL (unassigned/pending)  │ • Units: Choir, FWI, Men, etc│
└──────────────────────────────┴──────────────────────────────┘
```

### Tier 1: Functional Roles (Permissions)
Each staff member has **exactly one** role value in `staff_roles`:

| Role | Access Level | Permitted Routes & Capabilities |
|---|---|---|
| `super_admin` | Full Global Authority | `/home`, `/attendance`, `/dashboard`, `/approvals`, `/staff-approvals`, `/intake`<br>• Full church analytics<br>• Onboards and assigns roles to staff<br>• Starts and closes service sessions<br>• Reviews visitor queue and active rosters |
| `attendance_admin` | Attendance Domain Lead | `/home`, `/attendance`, `/dashboard`, `/approvals`, `/intake`<br>• Starts and closes service sessions<br>• View church-wide combined attendance<br>• Approves/merges visitor intake queue<br>• Multi-section roster switcher |
| `attendance_staff` | Mid-Service Usher | `/home`, `/attendance`, `/intake`<br>• Attendance roster strictly scoped to assigned section (`Adults & Youth`, `Infants`, `Older Children`, `Teenagers`)<br>• 1-tap presence marking (online + offline)<br>• Submits new visitor intake forms |
| `finance_admin` / `finance_staff` | Finance Domain | `/home` (displays upcoming domain placeholder cleanly) |
| `events_admin` / `events_staff` | Events Domain | `/home` (displays upcoming domain placeholder cleanly) |
| `NULL` / Unassigned | Pending Staff Account | Prompted to submit staff request or contact office |

### Tier 2: Positions & Units (Descriptive Tags)
- Stored as `positions text[]` and `unit_name text` on the `people` table.
- Examples: A person can have `positions: ['Senior Pastor']` with role `super_admin`, or `positions: ['Head Usher']` with role `attendance_admin`.
- Church titles **do not dictate permissions**. If a staff member steps down from leadership, their software role can be adjusted without altering their historical member profile or title.

---

## 3. Visual Identity & Design System

The application utilizes a tailored design language reflecting church heritage and modern SaaS clarity:

- **Color Palette**:
  - **Background**: `#F7F3EC` (Warm archival paper/parchment)
  - **Cards & Surfaces**: `#FDFBF7` (Soft alabaster white)
  - **Typography**: `#1F2A24` (Deep forest ink)
  - **Primary Brand / Accent**: `#A8763E` (Warm church bronze/amber)
  - **Presence / Active States**: `#4C6B52` (Deep liturgical moss green)
  - **Warnings & Alerts**: `#C94F3D` (Terracotta crimson)
- **Typography**:
  - **Headings & Numbers**: **Fraunces** (Editorial high-contrast optical serif)
  - **UI Labels & Data**: **Work Sans** (Clean, legible geometric grotesk)
- **Visual Structure**:
  - Architectural roofline brand mark representing Grace Assembly.
  - Minimal two-line page headers (bold title + date below, zero competing pill clutter).
  - Supabase-style left collapsible navigation rail with persistent collapsed/expanded state.

---

## 4. Architectural Features & System Modules

### 4.1. Authentication & Onboarding
- **Passwordless Email OTP**: Users sign in with their church email. Supabase generates a secure 8-digit code.
- **Pre-Flight Staff Verification (`/api/auth/check-staff`)**: Verifies the email belongs to a registered staff member before dispatching codes, preventing unauthorized OTP spam.
- **Staff Onboarding Request (`/staff-request`)**: Volunteers apply by providing their full name, email, phone, requested role, and section.
- **Super Admin Approvals (`/staff-approvals`)**: Gated exclusively to `super_admin`. Allows the administrator to review requests, adjust role or section assignments in-flight, and activate access.
- **Development Quick Access**: When `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true`, a quick-switch toolbar is rendered on the sign-in screen to instantly toggle between `super_admin`, `attendance_admin`, `attendance_staff`, and `finance_admin`. (Hard-disabled in production).

### 4.2. Navigation Shell (`AppShell.tsx`)
- **Responsive Breakpoints**:
  - **Phone (`< 640px`)**: Top header bar with brand mark and slide-out mobile drawer. Bottom sticky progress bars for quick touch access.
  - **Tablet (`640px – 1024px`)**: Narrow left icon rail (`68px`), 2-column dashboard grid, spacious attendance table.
  - **Laptop/Desktop (`1024px+`)**: Expandable left sidebar (`240px`), 4-column live attendance section cards, widescreen rosters, and capped reading-width forms (`560px`).
- **Sidebar Footer**: User avatar, full name/email, role label, live sync state indicator ("Synced" or "N pending"), and clean Sign Out action.

### 4.3. Service Session Lifecycle
- Added `status text` (`'active'` or `'closed'`) to the `services` table.
- **Single Active Session**: Starting a new service automatically closes any previously open session.
- **Unified Binding**: `/attendance`, `/dashboard`, and `/home` all bind directly to whichever service has `status = 'active'`, removing the ambiguity of date inferencing.

### 4.4. Home Page (`/home`)
- **Super Admin**: Combined attendance turnout summary, big live count, 4 section cards, and quick links to Staff Approvals and domain modules.
- **Attendance Admin**: "Start a new service session" action card + modal (custom service title, date, time), live section progress cards, and Approvals Queue quick link.
- **Attendance Staff**: Active service session details scoped to their room (`Adults & Youth`), section turnout progress, and direct "Go to Attendance" action. If no session is active, shows a clean waiting state.
- **Finance & Events**: Render polished "In Development" placeholders with domain-specific badges.

### 4.5. Attendance Screen (`/attendance`)
- **Role-Aware Scoping**: Attendance staff only see members in their physical seating room (e.g. `Adults & Youth`). Attendance Admins and Super Admins get section tabs and church-wide room running totals.
- **Instant Presence Toggle**: Tapping a person's status circle immediately toggles their presence with an optimistic UI update.
- **Search & Filter**: Search people by full name, phone number, or position tag (e.g. "Pastor", "Choir").
- **Offline Sync Engine**:
  - Toggles while offline are enqueued in IndexedDB (`attendance_queue`).
  - Network listener triggers auto-sync upon reconnection.
  - Sidebar and bottom bar update dynamically to show pending items and sync state.
- **New Person Intake Modal**: Ushers can quickly record an unlisted visitor without leaving the attendance screen.

### 4.6. Intake & Verification Queue (`/intake` & `/approvals`)
- **Intake Form (`/intake`)**: Collects visitor full name, phone, seating room, ministry unit, and first-time/returning status.
- **Real-Time Duplicate Detection**: As the phone number is entered, the app checks the database using prefix-normalized matching (`+234` vs `0`). If a match is found, a duplicate warning card appears.
- **Approval Queue (`/approvals`)**: Gated to `super_admin` and `attendance_admin`. Shows all pending submissions with collector context. Three actions:
  1. **Approve as New Person**: Inserts visitor into `people` table in their room and marks present for the active service.
  2. **Merge into Existing Record**: Links attendance to existing member profile, avoiding duplicate records.
  3. **Reject**: Discards erroneous submissions.

### 4.7. Admin Dashboard (`/dashboard`)
- Gated to `super_admin` and `attendance_admin`.
- **Tab 1: Live In-Progress Service**:
  - Combined turnout percentage gauge.
  - Total marked present vs. total on active roster.
  - 4-column section breakdown grid (`Adults & Youth`, `Infants`, `Older Children`, `Teenagers`) with individual percentages and active usher names.
  - Auto-refresh polling every 7 seconds.
- **Tab 2: Historical Services**:
  - Historical service archive with turnout totals, dates, and per-section breakdowns.

---

## 5. Walkthrough Demonstration Script

Use this step-by-step walkthrough script during demos to highlight all features in sequence:

### Step 1: Sign In & The New Home Experience
1. Navigate to `http://localhost:3000/`.
2. Notice the clean sign-in screen with the Grace Assembly roofline mark, dynamic greeting ("Good afternoon"), and passwordless OTP verification.
3. In development mode, point out the **Development Quick Access** toolbar.
4. Click **Super Admin** to sign in.
5. You land directly on the **new `/home` page**.
6. **Key Points to Mention**:
   - Point out the **Collapsible Supabase-style Sidebar** on the left. Toggle it collapsed to show the compact icon rail, and expanded to show full labels.
   - Point out the **Minimal Page Header**: Bold title ("Grace Assembly") with today's date underneath — zero pill clutter.
   - Note the **Combined Executive Summary**: Church turnout percentage, total marked present, and 4-column section breakdown.
   - Point out the **Sidebar Footer**: User profile, active role badge ("Super Admin"), and sync state indicator ("Synced").

### Step 2: Service Session Lifecycle (Starting a Service)
1. In the sidebar, sign out and click **Attendance Admin** quick login.
2. Observe the Attendance Admin's customized Home view:
   - Notice the **"Start a new service session"** action card.
   - Click **"Start Service Session"**. A clean modal opens with defaults (Date: today, Time: current time, Title: "Sunday Service").
   - Mention that starting a new service automatically closes any prior active session and binds all usher screens to this service.
   - Close or start the session.
   - Point out the **Live Room Totals** and **Approvals Queue** quick link.

### Step 3: Usher Mid-Service Attendance & Offline Engine
1. Switch to **Attendance Staff** via sign out and quick login.
2. The Home view adapts:
   - Shows active service info scoped to their section (`Adults & Youth`).
   - Click the primary **"Go to Attendance"** button.
3. You are now on `/attendance`:
   - Point out that this usher's view is scoped exclusively to their seating room.
   - Point out the clean two-line header: "Sunday Service" and date.
   - Search for a member by typing part of their name or phone in the search bar.
   - Tap the circular toggle next to an attendee — notice the **instant green checkmark** and progress bar increment.
   - Explain the **Offline Sync Engine**: If cellular reception drops mid-service, ushers can keep marking attendees without interruption. Toggles queue in IndexedDB and automatically sync when connection returns.
   - Click **"New person"** to show how an usher handles a visitor mid-service without polluting the directory.

### Step 4: Visitor Intake & Head Usher Approval Queue
1. In the sidebar, navigate to **Intake** (`/intake`).
2. Point out that the form caps at a comfortable reading width (`560px`) centered on the screen.
3. Type a visitor's name (e.g. "Samuel Adeyemi") and phone number.
4. Highlight that entering a phone number triggers live duplicate lookup.
5. Submit the record — it confirms that the submission has been routed to the **Head Usher Approval Queue**.
6. Switch back to **Attendance Admin** (or **Super Admin**) and click **Approvals Queue** (`/approvals`).
7. Point out the pending card:
   - Shows the visitor's details and who collected it.
   - Highlight the three choices: **Approve as New Person**, **Merge into Existing Record**, or **Reject**.
   - Click **"Approve as New Person"** — the attendee is instantly verified and added to the seating room's roster.

### Step 5: Executive Attendance Dashboard
1. Navigate to **Dashboard** (`/dashboard`).
2. Point out the **Responsive Grid Layout**:
   - On desktop, the 4 section cards lay out in a clean 4-column grid (`lg:grid-cols-4`).
   - On tablet, they adapt into 2 columns.
   - On phone, they stack into a single column.
3. Show the **Combined Hero Card**: Big turnout percentage, marked attendee count, and gradient progress bar.
4. Switch to the **"Past Services History"** tab to show past Sunday records.

### Step 6: Super Admin Staff Approvals Gate
1. Navigate to **Staff Approvals** (`/staff-approvals`).
2. Mention that this screen is **strictly gated to `super_admin`** (domain admins like Attendance Admin receive a 403 Forbidden card).
3. Show how a super admin can review volunteer onboarding requests, modify their assigned role or section before approving, or reject the request.

### Step 7: Domain Placeholders
1. Sign in as **Finance Admin** (`dev-login-finance-admin-button`).
2. The Home view displays the **Finance Domain · In Development** placeholder.
3. Explain that all 7 roles exist in the database schema now, so future finance and events releases will plug into the existing permission model without needing schema migrations.

---

## 6. Project Structure & Key Files

```
grace-assembly/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # Welcome & Email OTP Sign-in + Dev Quick Login
│   │   ├── home/page.tsx                # Role-aware Home Landing Dashboard
│   │   ├── attendance/page.tsx          # Usher Mid-Service Attendance Screen
│   │   ├── intake/page.tsx              # Visitor & New Person Intake Form
│   │   ├── approvals/page.tsx           # Head Usher Intake Review & Approval Queue
│   │   ├── dashboard/page.tsx           # Combined Executive Attendance Analytics
│   │   ├── staff-approvals/page.tsx     # Super Admin Staff Account Review Gate
│   │   ├── staff-request/page.tsx       # Public Volunteer Staff Onboarding Form
│   │   └── api/
│   │       ├── services/active/         # Active service session GET & POST start
│   │       ├── attendance/service/      # Service resolver (active status priority)
│   │       ├── attendance/toggle/       # Attendance marking toggle handler
│   │       ├── attendance/search/       # RPC-backed roster search
│   │       ├── dashboard/stats/         # Executive combined metrics & section stats
│   │       ├── intake/submit/           # Submits visitor record to pending queue
│   │       ├── intake/pending/          # Fetches unapproved visitor submissions
│   │       ├── intake/action/           # Approve new, merge, or reject visitor
│   │       └── staff-requests/          # Volunteer onboarding submission & actions
│   ├── components/
│   │   └── layout/
│   │       ├── AppShell.tsx             # Collapsible sidebar & responsive layout shell
│   │       └── PageHeader.tsx           # Minimal clean two-line header component
│   └── lib/
│       ├── supabase/client.ts           # Supabase browser client
│       ├── supabase/admin.ts            # Supabase service role admin client
│       └── offline/attendanceQueue.ts   # IndexedDB offline storage & sync queue
└── supabase/migrations/
    ├── 008_pending_people_and_intake.sql        # Visitor queue & RPC phone check
    ├── 009_pending_staff_requests.sql           # Staff request table & policies
    ├── 010_two_tier_roles_and_positions.sql     # Two-tier roles enum & positions migration
    └── 011_service_session_status.sql           # Service session active/closed status
```
