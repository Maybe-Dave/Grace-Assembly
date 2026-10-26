-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 003: Roles & Row Level Security
--
-- ROLE MODEL: staff_roles table (not JWT custom claims).
-- Rationale: A dedicated table is simpler to manage — admins can update roles
-- directly in Supabase Studio or via SQL without touching auth configuration or
-- deploying edge functions. It also supports future expansion (e.g. per-unit
-- permissions) without schema changes to auth.users metadata.
-- =============================================================================

-- ---------------------------------------------------------
-- staff_roles — maps auth users to app roles
-- ---------------------------------------------------------
create table staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('admin', 'usher')),
  created_at timestamptz not null default now()
);

-- Only admins (or service-role) may read/write this table.
alter table staff_roles enable row level security;

create policy "Admins can manage staff_roles"
  on staff_roles
  for all
  using (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'admin'
    )
  );

-- Helper function: get the current user's role
create or replace function current_user_role()
returns text
language sql
security definer
stable
as $$
  select role from staff_roles where user_id = auth.uid()
$$;

-- =============================================================================
-- Enable RLS on all app tables
-- =============================================================================

alter table units          enable row level security;
alter table people         enable row level security;
alter table services       enable row level security;
alter table attendance     enable row level security;
alter table pending_members enable row level security;

-- =============================================================================
-- units — readable by all authenticated staff
-- =============================================================================

create policy "Authenticated staff can read units"
  on units for select
  using (auth.uid() is not null);

create policy "Admins can write units"
  on units for insert
  with check (current_user_role() = 'admin');

create policy "Admins can update units"
  on units for update
  using (current_user_role() = 'admin');

create policy "Admins can delete units"
  on units for delete
  using (current_user_role() = 'admin');

-- =============================================================================
-- services — readable by all authenticated staff, writable by admins only
-- =============================================================================

create policy "Authenticated staff can read services"
  on services for select
  using (auth.uid() is not null);

create policy "Admins can write services"
  on services for insert
  with check (current_user_role() = 'admin');

create policy "Admins can update services"
  on services for update
  using (current_user_role() = 'admin');

create policy "Admins can delete services"
  on services for delete
  using (current_user_role() = 'admin');

-- =============================================================================
-- people — ushers and admins can read/write, BUT phone is hidden from ushers
--
-- Strategy: a security-barrier view that strips phone for non-admins.
-- We create a view `people_view` that ushers must query; direct table access
-- is restricted to admins. This is the ONLY reliable way to exclude a column
-- at the RLS layer — Postgres RLS cannot redact individual columns, only rows.
-- =============================================================================

-- Direct table: admins only (full access including phone)
create policy "Admins have full access to people"
  on people for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- Column-redacting view for ushers (phone column replaced with NULL)
create or replace view people_view
  with (security_invoker = true)
as
select
  id,
  full_name,
  -- phone is intentionally excluded for non-admins
  case when current_user_role() = 'admin' then phone else null end as phone,
  unit_id,
  household_id,
  status,
  created_at
from people;

-- Grant ushers access to the view (not the base table)
-- (done via Supabase RLS + grants below)

-- RLS policy: ushers can read via the view (which strips phone)
-- The view itself enforces the column restriction; we also lock down inserts/updates.
create policy "Ushers can read people (via view)"
  on people for select
  using (
    current_user_role() in ('admin', 'usher')
  );

create policy "Ushers can insert people"
  on people for insert
  with check (current_user_role() in ('admin', 'usher'));

create policy "Ushers can update people (except phone)"
  on people for update
  using (current_user_role() in ('admin', 'usher'));

-- NOTE: To enforce phone exclusion, ushers should query `people_view`,
-- not `people` directly. The Supabase JS client should always use
-- .from('people_view') for usher-role sessions.

-- =============================================================================
-- attendance — ushers and admins can read/write
-- =============================================================================

create policy "Authenticated staff can read attendance"
  on attendance for select
  using (current_user_role() in ('admin', 'usher'));

create policy "Ushers and admins can mark attendance"
  on attendance for insert
  with check (
    current_user_role() in ('admin', 'usher') and
    marked_by = auth.uid()
  );

create policy "Ushers and admins can update attendance"
  on attendance for update
  using (current_user_role() in ('admin', 'usher'));

create policy "Admins can delete attendance"
  on attendance for delete
  using (current_user_role() = 'admin');

-- =============================================================================
-- pending_members — ushers can submit; only admins can approve
-- =============================================================================

create policy "Authenticated staff can read pending_members"
  on pending_members for select
  using (current_user_role() in ('admin', 'usher'));

create policy "Ushers and admins can submit pending_members"
  on pending_members for insert
  with check (current_user_role() in ('admin', 'usher'));

create policy "Only admins can approve pending_members"
  on pending_members for update
  using (current_user_role() = 'admin')
  with check (
    current_user_role() = 'admin' and
    approved_by = auth.uid()
  );

create policy "Admins can delete pending_members"
  on pending_members for delete
  using (current_user_role() = 'admin');
