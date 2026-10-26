-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 002: Seed Data
-- =============================================================================

-- ---------------------------------------------------------
-- Seed units — 6 ministry units
-- ---------------------------------------------------------
insert into units (name) values
  ('Youth'),
  ('Ushers'),
  ('FWI'),
  ('Men''s Fellowship'),
  ('Children'),
  ('Choir');

-- ---------------------------------------------------------
-- Seed services — next Sunday's service
-- Dynamically inserts the upcoming Sunday from the migration run date.
-- If today is Sunday, inserts the NEXT Sunday (not today).
-- ---------------------------------------------------------
insert into services (type, service_date, service_time)
values (
  'Sunday Service',
  -- Next Sunday: dow 0 = Sunday; shift forward to next occurrence
  (date_trunc('week', current_date + interval '7 days') + interval '6 days')::date,
  '09:00'
);
