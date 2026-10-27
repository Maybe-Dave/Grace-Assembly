-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 005: Add email column to people table
--
-- Staff members (admins, ushers) need an email on their person record for sign-in.
-- Regular members don't need one — this column is nullable.
-- =============================================================================

ALTER TABLE people ADD COLUMN IF NOT EXISTS email text UNIQUE;

-- Update people_view to include email
CREATE OR REPLACE VIEW people_view
  WITH (security_invoker = true)
AS
SELECT
  id,
  full_name,
  -- phone is intentionally excluded for non-admins
  CASE WHEN current_user_role() = 'admin' THEN phone ELSE NULL END AS phone,
  email,
  unit_id,
  household_id,
  status,
  created_at
FROM people;
