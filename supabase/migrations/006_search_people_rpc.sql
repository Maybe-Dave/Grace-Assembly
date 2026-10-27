-- =============================================================================
-- Grace Assembly Church Management App
-- Migration 006: search_people_for_service RPC
--
-- Matches search query against name AND phone, but never returns phone column.
-- Ushers can search by phone without ever seeing anyone's phone number.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_people_for_service(
  search_query text,
  service_id_param uuid
)
RETURNS TABLE (
  id uuid,
  full_name text,
  unit_name text,
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
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.service_id = service_id_param AND a.person_id = p.id
    ) AS is_present
  FROM people p
  LEFT JOIN units u ON u.id = p.unit_id
  WHERE p.status = 'active'
    AND (
      search_query = ''
      OR p.full_name ILIKE '%' || search_query || '%'
      OR p.phone ILIKE '%' || search_query || '%'
    )
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION search_people_for_service TO authenticated;
