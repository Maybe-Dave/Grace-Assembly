-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 010: Two-Tier Role & Position Model
--
-- 1. ROLES (Permissions):
--    super_admin, attendance_admin, attendance_staff,
--    finance_admin, finance_staff, events_admin, events_staff, or NULL.
--
-- 2. POSITIONS (Descriptive tags on people, no inherent permissions):
--    people.positions text[] array
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADD POSITIONS ARRAY TO PEOPLE
-- -----------------------------------------------------------------------------
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS positions text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_people_positions ON people USING GIN (positions);

-- -----------------------------------------------------------------------------
-- 2. MIGRATE DATA IN STAFF_ROLES & PEOPLE
-- -----------------------------------------------------------------------------

-- Tag people records for anyone currently registered as pastor
UPDATE people p
SET positions = array_append(COALESCE(p.positions, '{}'::text[]), 'Pastor')
FROM staff_roles sr
JOIN auth.users u ON u.id = sr.user_id
WHERE sr.role = 'pastor'
  AND lower(p.email) = lower(u.email)
  AND NOT ('Pastor' = ANY(COALESCE(p.positions, '{}'::text[])));

-- Tag people records for anyone currently registered as secretary
UPDATE people p
SET positions = array_append(COALESCE(p.positions, '{}'::text[]), 'Church Secretary')
FROM staff_roles sr
JOIN auth.users u ON u.id = sr.user_id
WHERE sr.role = 'secretary'
  AND lower(p.email) = lower(u.email)
  AND NOT ('Church Secretary' = ANY(COALESCE(p.positions, '{}'::text[])));

-- Drop the old role check constraint
ALTER TABLE staff_roles DROP CONSTRAINT IF EXISTS staff_roles_role_check;

-- Remap staff_roles values:
-- admin -> super_admin
UPDATE staff_roles SET role = 'super_admin' WHERE role = 'admin';

-- head_usher -> attendance_admin
UPDATE staff_roles SET role = 'attendance_admin' WHERE role = 'head_usher';

-- usher -> attendance_staff
UPDATE staff_roles SET role = 'attendance_staff' WHERE role = 'usher';

-- pastor & secretary -> NULL (permissions removed, preserved as positions tag)
UPDATE staff_roles SET role = NULL WHERE role IN ('pastor', 'secretary');

-- Apply the new role enum check constraint
ALTER TABLE staff_roles
  ADD CONSTRAINT staff_roles_role_check
  CHECK (role IN (
    'super_admin',
    'attendance_admin',
    'attendance_staff',
    'finance_admin',
    'finance_staff',
    'events_admin',
    'events_staff'
  ) OR role IS NULL);

-- -----------------------------------------------------------------------------
-- 3. UPDATE PENDING_STAFF_REQUESTS
-- -----------------------------------------------------------------------------
ALTER TABLE pending_staff_requests DROP CONSTRAINT IF EXISTS pending_staff_requests_requested_role_check;

UPDATE pending_staff_requests SET requested_role = 'attendance_staff' WHERE requested_role = 'usher';
UPDATE pending_staff_requests SET requested_role = 'attendance_admin' WHERE requested_role = 'head_usher';

ALTER TABLE pending_staff_requests
  ADD CONSTRAINT pending_staff_requests_requested_role_check
  CHECK (requested_role IN (
    'attendance_staff',
    'attendance_admin',
    'finance_staff',
    'finance_admin',
    'events_staff',
    'events_admin'
  ));

-- Update RLS on pending_staff_requests: super_admin ONLY for reviews
DROP POLICY IF EXISTS "Anyone can submit staff access request" ON pending_staff_requests;
CREATE POLICY "Anyone can submit staff access request"
  ON pending_staff_requests
  FOR INSERT
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Pastor and secretary can view pending staff requests" ON pending_staff_requests;
DROP POLICY IF EXISTS "Super admin can view pending staff requests" ON pending_staff_requests;
CREATE POLICY "Super admin can view pending staff requests"
  ON pending_staff_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Pastor and secretary can update pending staff requests" ON pending_staff_requests;
DROP POLICY IF EXISTS "Super admin can update pending staff requests" ON pending_staff_requests;
CREATE POLICY "Super admin can update pending staff requests"
  ON pending_staff_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role = 'super_admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 4. UPDATE PENDING_PEOPLE RLS (Intake Approval Queue)
-- -----------------------------------------------------------------------------
-- Accessible to super_admin and attendance_admin
DROP POLICY IF EXISTS "Staff can review pending people queue" ON pending_people;
CREATE POLICY "Staff can review pending people queue"
  ON pending_people
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role IN ('super_admin', 'attendance_admin')
    )
  );

DROP POLICY IF EXISTS "Staff can update pending people queue" ON pending_people;
CREATE POLICY "Staff can update pending people queue"
  ON pending_people
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role IN ('super_admin', 'attendance_admin')
    )
  );

-- -----------------------------------------------------------------------------
-- 5. UPDATE PEOPLE_VIEW AND HELPER FUNCTIONS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW people_view
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.full_name,
  CASE WHEN current_user_role() = 'super_admin' THEN p.phone ELSE NULL END AS phone,
  p.email,
  p.unit_id,
  p.section,
  p.positions,
  p.household_id,
  p.status,
  p.created_at
FROM people p;

-- -----------------------------------------------------------------------------
-- 6. UPDATE SEARCH_PEOPLE_FOR_SERVICE RPC (Search by Name, Phone & Positions)
-- -----------------------------------------------------------------------------
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
  positions text[],
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
    p.positions,
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
      OR EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.positions, '{}'::text[])) pos
        WHERE pos ILIKE '%' || search_query || '%'
      )
    )
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION search_people_for_service TO authenticated;
GRANT EXECUTE ON FUNCTION search_people_for_service TO anon;
