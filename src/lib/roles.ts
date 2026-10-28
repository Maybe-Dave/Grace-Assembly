export type StaffRole =
  | 'super_admin'
  | 'attendance_admin'
  | 'attendance_staff'
  | 'finance_admin'
  | 'finance_staff'
  | 'events_admin'
  | 'events_staff'

/**
 * Normalizes a role string to the canonical two-tier staff role enum.
 * Supports backward-compatibility with legacy pre-migration role strings:
 * - 'admin'       -> 'super_admin'
 * - 'head_usher'  -> 'attendance_admin'
 * - 'usher'       -> 'attendance_staff'
 * - 'pastor'      -> null (permissions moved to descriptive positions)
 * - 'secretary'   -> null
 */
export function normalizeRole(role: string | null | undefined): StaffRole | null {
  if (!role) return null
  const clean = role.trim().toLowerCase()
  if (clean === 'admin' || clean === 'super_admin') return 'super_admin'
  if (clean === 'head_usher' || clean === 'attendance_admin') return 'attendance_admin'
  if (clean === 'usher' || clean === 'attendance_staff') return 'attendance_staff'
  if (clean === 'finance_admin') return 'finance_admin'
  if (clean === 'finance_staff') return 'finance_staff'
  if (clean === 'events_admin') return 'events_admin'
  if (clean === 'events_staff') return 'events_staff'
  return null
}

export function formatRoleLabel(role: string | null | undefined): string {
  const norm = normalizeRole(role)
  switch (norm) {
    case 'super_admin':
      return 'Super Admin'
    case 'attendance_admin':
      return 'Attendance Admin'
    case 'attendance_staff':
      return 'Attendance Staff'
    case 'finance_admin':
      return 'Finance Admin'
    case 'finance_staff':
      return 'Finance Staff'
    case 'events_admin':
      return 'Events Admin'
    case 'events_staff':
      return 'Events Staff'
    default:
      return 'Staff Member'
  }
}
