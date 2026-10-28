-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 011: Service Session Status Lifecycle ('active' / 'closed')
-- =============================================================================

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'closed'
  CHECK (status IN ('active', 'closed'));

CREATE INDEX IF NOT EXISTS idx_services_status ON services (status);

-- Mark the most recent service as 'active' if no active service currently exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM services WHERE status = 'active') THEN
    UPDATE services
    SET status = 'active'
    WHERE id = (
      SELECT id FROM services
      ORDER BY service_date DESC, service_time DESC
      LIMIT 1
    );
  END IF;
END $$;
