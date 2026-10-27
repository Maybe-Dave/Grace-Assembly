-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 009: Pending Staff Requests (Staff Account Onboarding & Approval)
-- =============================================================================

-- 1. Table: pending_staff_requests
CREATE TABLE IF NOT EXISTS pending_staff_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('usher', 'head_usher')),
  requested_section TEXT NOT NULL CHECK (requested_section IN ('Adults & Youth', 'Infants', 'Older Children', 'Teenagers')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookup on status and email
CREATE INDEX IF NOT EXISTS idx_pending_staff_status ON pending_staff_requests(status);
CREATE INDEX IF NOT EXISTS idx_pending_staff_email ON pending_staff_requests(lower(email));

-- 2. Enable RLS
ALTER TABLE pending_staff_requests ENABLE ROW LEVEL SECURITY;

-- Public/Unauthenticated users can submit staff access requests
DROP POLICY IF EXISTS "Anyone can submit staff access request" ON pending_staff_requests;
CREATE POLICY "Anyone can submit staff access request"
  ON pending_staff_requests
  FOR INSERT
  WITH CHECK (status = 'pending' AND requested_role IN ('usher', 'head_usher'));

-- Only pastor, secretary, or service-role can view and update pending staff requests
DROP POLICY IF EXISTS "Pastor and secretary can view pending staff requests" ON pending_staff_requests;
CREATE POLICY "Pastor and secretary can view pending staff requests"
  ON pending_staff_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role IN ('pastor', 'secretary')
    )
  );

DROP POLICY IF EXISTS "Pastor and secretary can update pending staff requests" ON pending_staff_requests;
CREATE POLICY "Pastor and secretary can update pending staff requests"
  ON pending_staff_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_roles sr
      WHERE sr.user_id = auth.uid()
        AND sr.role IN ('pastor', 'secretary')
    )
  );
