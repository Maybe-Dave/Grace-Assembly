-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 008: Pending People Intake Queue & Head Usher Approval
--
-- 1. Intake queue table: pending_people
-- 2. Staff role support for 'head_usher'
-- 3. Live phone duplicate lookup RPC
-- 4. RLS policies:
--    - Ushers can submit to pending_people
--    - Only head_usher (and admin) can approve/merge/reject
-- =============================================================================

-- 1. Create pending_people intake queue table
CREATE TABLE IF NOT EXISTS pending_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  section text NOT NULL DEFAULT 'Adults & Youth'
    CHECK (section IN ('Adults & Youth', 'Infants', 'Older Children', 'Teenagers')),
  unit_name text NOT NULL DEFAULT 'Visitor',
  status_flag text NOT NULL DEFAULT 'first_time'
    CHECK (status_flag IN ('first_time', 'returning')),
  duplicate_matched_person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_by_name text,
  submitted_by_section text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'merged', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_people_status ON pending_people(status);
CREATE INDEX IF NOT EXISTS idx_pending_people_phone ON pending_people(phone);

-- 2. Expand staff_roles to support head_usher, pastor, secretary
ALTER TABLE staff_roles DROP CONSTRAINT IF EXISTS staff_roles_role_check;
ALTER TABLE staff_roles ADD CONSTRAINT staff_roles_role_check 
  CHECK (role IN ('admin', 'pastor', 'secretary', 'head_usher', 'usher'));

-- 3. Enable RLS on pending_people
ALTER TABLE pending_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated staff can insert into pending_people" ON pending_people;
CREATE POLICY "Authenticated staff can insert into pending_people"
  ON pending_people FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff can view pending_people" ON pending_people;
CREATE POLICY "Staff can view pending_people"
  ON pending_people FOR SELECT
  USING (
    current_user_role() IN ('admin', 'head_usher', 'pastor', 'secretary')
    OR submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "Head ushers and admins can update pending_people" ON pending_people;
CREATE POLICY "Head ushers and admins can update pending_people"
  ON pending_people FOR UPDATE
  USING (current_user_role() IN ('admin', 'head_usher', 'pastor', 'secretary'));

-- 4. RPC for live non-blocking phone duplicate check
-- Normalizes: strips spaces/dashes, handles +234 prefix ↔ leading-0 interchangeably
CREATE OR REPLACE FUNCTION check_phone_duplicate(phone_query text)
RETURNS TABLE (
  matched boolean,
  matched_person_id uuid,
  matched_name text,
  matched_unit text,
  matched_section text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    -- Strip all non-digit characters
    SELECT regexp_replace(phone_query, '[^0-9]', '', 'g') AS digits
  ),
  variants AS (
    -- Build multiple equivalent forms of the number to match against
    SELECT digits AS v1,
           -- If starts with 234, add leading 0 variant (234XXXXXXXXXX → 0XXXXXXXXXX)
           CASE WHEN digits LIKE '234%' THEN '0' || substring(digits FROM 4) ELSE NULL END AS v2,
           -- If starts with 0, add +234 variant (0XXXXXXXXXX → 234XXXXXXXXXX)
           CASE WHEN digits LIKE '0%' THEN '234' || substring(digits FROM 2) ELSE NULL END AS v3
    FROM normalized
  )
  SELECT
    true AS matched,
    p.id AS matched_person_id,
    p.full_name AS matched_name,
    COALESCE(u.name, 'Member') AS matched_unit,
    p.section AS matched_section
  FROM people p
  LEFT JOIN units u ON u.id = p.unit_id
  CROSS JOIN variants
  WHERE p.status = 'active'
    AND (
      regexp_replace(p.phone, '[^0-9]', '', 'g') = variants.v1
      OR regexp_replace(p.phone, '[^0-9]', '', 'g') = variants.v2
      OR regexp_replace(p.phone, '[^0-9]', '', 'g') = variants.v3
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION check_phone_duplicate TO authenticated;
GRANT EXECUTE ON FUNCTION check_phone_duplicate TO anon;
