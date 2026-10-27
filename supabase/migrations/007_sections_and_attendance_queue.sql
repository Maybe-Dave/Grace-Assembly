-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 007: Sections & Client Mark Id for Idempotent Attendance
--
-- 1. Unit vs Section separation:
--    - unit = ministry role (Choir, Ushers, FWI, Men’s Fellowship, Youth, Children, Member, Visitor)
--    - section = physical seating area (Adults & Youth, Infants, Older Children, Teenagers)
-- 2. Staff section assignment:
--    - staff_roles gets assigned_section
-- 3. Idempotent attendance marking:
--    - attendance gets client_mark_id (client-generated UUID)
-- 4. Section-scoped search RPC:
--    - search_people_for_service filters by section
-- =============================================================================

-- 1. Ensure 'Member' (no ministry) and 'Visitor' units exist in units table
INSERT INTO units (name) VALUES
  ('Member'),
  ('Visitor')
ON CONFLICT (name) DO NOTHING;

-- 2. Add section column to people table
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'Adults & Youth'
  CHECK (section IN ('Adults & Youth', 'Infants', 'Older Children', 'Teenagers'));

-- If any person has no unit_id, default to 'Member'
UPDATE people
SET unit_id = (SELECT id FROM units WHERE name = 'Member')
WHERE unit_id IS NULL;

-- 3. Update people_view to include section
-- Note: DROP VIEW CASCADE is required because Postgres disallows changing column names/order via CREATE OR REPLACE VIEW
DROP VIEW IF EXISTS people_view CASCADE;

CREATE VIEW people_view
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.full_name,
  CASE WHEN current_user_role() = 'admin' THEN p.phone ELSE NULL END AS phone,
  p.email,
  p.unit_id,
  p.section,
  p.household_id,
  p.status,
  p.created_at
FROM people p;

GRANT SELECT ON people_view TO authenticated;
GRANT SELECT ON people_view TO anon;

-- 4. Add assigned_section to staff_roles table
ALTER TABLE staff_roles
  ADD COLUMN IF NOT EXISTS assigned_section text DEFAULT 'Adults & Youth'
  CHECK (assigned_section IN ('Adults & Youth', 'Infants', 'Older Children', 'Teenagers') OR assigned_section IS NULL);

-- 5. Add client_mark_id to attendance table for idempotent deduplication
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS client_mark_id uuid;

-- 6. Update search_people_for_service RPC function
DROP FUNCTION IF EXISTS search_people_for_service(text, uuid);
DROP FUNCTION IF EXISTS search_people_for_service(text, uuid, text);

CREATE OR REPLACE FUNCTION search_people_for_service(
  search_query text,
  service_id_param uuid,
  section_param text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  full_name text,
  unit_name text,
  section text,
  is_present boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    u.name AS unit_name,
    p.section,
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.service_id = service_id_param AND a.person_id = p.id
    ) AS is_present
  FROM people p
  LEFT JOIN units u ON u.id = p.unit_id
  WHERE p.status = 'active'
    AND (
      section_param IS NULL
      OR section_param = ''
      OR section_param = 'All Sections'
      OR p.section = section_param
    )
    AND (
      search_query = ''
      OR p.full_name ILIKE '%' || search_query || '%'
      OR p.phone ILIKE '%' || search_query || '%'
    )
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION search_people_for_service TO authenticated;
GRANT EXECUTE ON FUNCTION search_people_for_service TO anon;

-- 7. Seed sample sections across initial members for multi-room testing
UPDATE people
SET section = 'Adults & Youth'
WHERE unit_id IN (SELECT id FROM units WHERE name IN ('Choir', 'Ushers', 'FWI', 'Men''s Fellowship', 'Member'));

UPDATE people
SET section = 'Teenagers'
WHERE unit_id IN (SELECT id FROM units WHERE name = 'Youth');

UPDATE people
SET section = 'Older Children'
WHERE unit_id IN (SELECT id FROM units WHERE name = 'Children')
  AND id IN (SELECT id FROM people WHERE unit_id IN (SELECT id FROM units WHERE name = 'Children') LIMIT 1);

UPDATE people
SET section = 'Infants'
WHERE unit_id IN (SELECT id FROM units WHERE name = 'Children')
  AND id NOT IN (SELECT id FROM people WHERE section = 'Older Children');
