-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 001: Core Schema
-- =============================================================================

-- ---------------------------------------------------------
-- units — ministry units / departments
-- ---------------------------------------------------------
create table units (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- people — church members
-- ---------------------------------------------------------
create table people (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  phone        text not null unique,
  unit_id      uuid references units(id),
  household_id uuid,            -- nullable; groups family members together
  status       text not null default 'active'
                 check (status in ('active', 'pending', 'inactive')),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- services — individual church services
-- ---------------------------------------------------------
create table services (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,   -- e.g. 'Sunday Service'
  service_date date not null,
  service_time time not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- attendance — who attended which service
-- ---------------------------------------------------------
create table attendance (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  person_id  uuid not null references people(id),
  marked_by  uuid not null references auth.users(id),
  marked_at  timestamptz not null default now(),
  unique (service_id, person_id)  -- one row per person per service
);

-- ---------------------------------------------------------
-- pending_members — members awaiting approval
-- ---------------------------------------------------------
create table pending_members (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  submitted_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at  timestamptz
);
