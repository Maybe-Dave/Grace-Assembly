const DEVICE_SESSION_KEY = 'ga_device_session_v1'
const REMEMBERED_EMAIL_KEY = 'ga_remembered_email'
const REMEMBER_ENABLED_KEY = 'ga_remember_email_enabled'
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000 // 30 days in ms (2,592,000,000 ms)

export interface DeviceSessionRecord {
  email: string
  sessionStart: number // timestamp in ms
  lastActive: number   // timestamp in ms
}

/**
 * Records a successful login on this device with a 30-day validity window.
 */
export function recordDeviceLogin(email: string): void {
  if (typeof window === 'undefined') return
  try {
    const record: DeviceSessionRecord = {
      email: email.trim().toLowerCase(),
      sessionStart: Date.now(),
      lastActive: Date.now(),
    }
    localStorage.setItem(DEVICE_SESSION_KEY, JSON.stringify(record))
  } catch (_) {}
}

/**
 * Verifies whether the current device session is within the 30-day window.
 * Returns true if valid, false if 30 days have elapsed.
 * If valid, bumps `lastActive`.
 */
export function isDeviceSessionValid(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(DEVICE_SESSION_KEY)
    if (!raw) {
      // If there's an existing session in the browser without a start record,
      // start the 30-day timer from now so they aren't prematurely logged out
      return true
    }
    const record: DeviceSessionRecord = JSON.parse(raw)
    if (!record.sessionStart) return true

    const elapsed = Date.now() - record.sessionStart
    if (elapsed > THIRTY_DAYS_MS) {
      return false
    }

    // Still valid — update last active timestamp
    record.lastActive = Date.now()
    localStorage.setItem(DEVICE_SESSION_KEY, JSON.stringify(record))
    return true
  } catch (_) {
    return true
  }
}

/**
 * Clears the active device session on sign out.
 * Preserves the remembered email so the user doesn't have to retype it.
 */
export function clearDeviceSession(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(DEVICE_SESSION_KEY)
  } catch (_) {}
}

/**
 * Gets the remembered email for this device, if any.
 */
export function getRememberedEmail(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Stores or clears the remembered email for this device.
 */
export function setRememberedEmail(email: string, remember: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(REMEMBER_ENABLED_KEY, remember ? 'true' : 'false')
    if (remember && email.trim()) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim().toLowerCase())
    } else if (!remember) {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY)
    }
  } catch (_) {}
}

/**
 * Checks whether the "Remember Email" toggle is enabled on this device (defaults to true).
 */
export function isRememberEmailEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const val = localStorage.getItem(REMEMBER_ENABLED_KEY)
    return val !== 'false'
  } catch {
    return true
  }
}
