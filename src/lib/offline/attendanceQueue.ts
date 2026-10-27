/**
 * Grace Assembly Church Management App
 * Offline Attendance Queue using IndexedDB
 *
 * Implements:
 * 1. IndexedDB persistence for offline attendance changes.
 * 2. Collapse-to-final-state queueing by (service_id, person_id).
 * 3. Client-generated unique id per mark for idempotent duplicate detection.
 * 4. Sequential FIFO replay on reconnect with backoff.
 * 5. Local caching of service, member directory by section, and room stats.
 */

export interface QueuedAttendanceItem {
  key: string // Composite key: `${serviceId}_${personId}`
  id: string // Client-generated unique id at moment mark is created
  serviceId: string
  personId: string
  isPresent: boolean
  updatedAt: number
  retryCount: number
  lastError?: string | null
}

const DB_NAME = 'grace_assembly_offline_db'
const DB_VERSION = 1
const QUEUE_STORE = 'attendance_queue'
const CACHE_STORE = 'cached_service_data'

let isSyncRunning = false

/**
 * Open or upgrade the IndexedDB database.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // 1. Queue store: keyed by composite key (serviceId_personId)
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'key' })
      }

      // 2. Cache store for active service, section directory, and stats
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Generate a client-side UUID v4
 */
export function generateClientMarkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Enqueue an attendance change into IndexedDB.
 *
 * CRITICAL RULE: Queue by PERSON, not by tap.
 * Overwrites any previous pending entry for (service_id, person_id) so the queue
 * collapses into ONE entry holding the final intended state, with a client-generated ID.
 */
export async function enqueueAttendance(
  serviceId: string,
  personId: string,
  isPresent: boolean,
  clientMarkId?: string
): Promise<QueuedAttendanceItem> {
  const db = await openDatabase()
  const key = `${serviceId}_${personId}`
  const id = clientMarkId || generateClientMarkId()

  const item: QueuedAttendanceItem = {
    key,
    id,
    serviceId,
    personId,
    isPresent,
    updatedAt: Date.now(),
    retryCount: 0,
    lastError: null,
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const request = store.put(item)

    request.onsuccess = () => resolve(item)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Remove an item from the queue once successfully synced.
 */
export async function dequeueAttendance(key: string): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const request = store.delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all currently queued attendance items.
 */
export async function getQueuedAttendance(): Promise<QueuedAttendanceItem[]> {
  if (typeof window === 'undefined' || !window.indexedDB) return []
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly')
      const store = tx.objectStore(QUEUE_STORE)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch {
    return []
  }
}

/**
 * Get total count of pending items in the queue.
 */
export async function getQueuedCount(): Promise<number> {
  if (typeof window === 'undefined' || !window.indexedDB) return 0
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly')
      const store = tx.objectStore(QUEUE_STORE)
      const request = store.count()

      request.onsuccess = () => resolve(request.result || 0)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return 0
  }
}

/**
 * Update error and increment retry count on sync failure.
 */
export async function recordQueueSyncFailure(key: string, errorMsg: string): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const getReq = store.get(key)

    getReq.onsuccess = () => {
      const item = getReq.result as QueuedAttendanceItem | undefined
      if (item) {
        item.retryCount = (item.retryCount || 0) + 1
        item.lastError = errorMsg
        item.updatedAt = Date.now()
        store.put(item)
      }
      resolve()
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Caching helpers for offline startup
 */
export async function cacheServiceData(service: any): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  return new Promise((resolve) => {
    openDatabase()
      .then((db) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite')
        tx.objectStore(CACHE_STORE).put({ key: 'active_service', data: service })
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      .catch(() => resolve())
  })
}

export async function getCachedServiceData(): Promise<any | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly')
      const req = tx.objectStore(CACHE_STORE).get('active_service')
      req.onsuccess = () => resolve(req.result?.data ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function cacheDirectoryMembers(
  serviceId: string,
  section: string,
  members: any[]
): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  return new Promise((resolve) => {
    openDatabase()
      .then((db) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite')
        const cacheKey = `members_${serviceId}_${section || 'all'}`
        tx.objectStore(CACHE_STORE).put({ key: cacheKey, data: members })
        // Also keep general service cache
        tx.objectStore(CACHE_STORE).put({ key: `members_${serviceId}`, data: members })
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      .catch(() => resolve())
  })
}

export async function getCachedDirectoryMembers(
  serviceId: string,
  section?: string
): Promise<any[] | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly')
      const store = tx.objectStore(CACHE_STORE)
      const primaryKey = `members_${serviceId}_${section || 'all'}`
      const req = store.get(primaryKey)
      req.onsuccess = () => {
        if (req.result?.data) {
          resolve(req.result.data)
        } else {
          // Fallback to general cache
          const fallbackReq = store.get(`members_${serviceId}`)
          fallbackReq.onsuccess = () => resolve(fallbackReq.result?.data ?? null)
          fallbackReq.onerror = () => resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function cacheSectionStats(serviceId: string, stats: any): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  return new Promise((resolve) => {
    openDatabase()
      .then((db) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite')
        tx.objectStore(CACHE_STORE).put({ key: `stats_${serviceId}`, data: stats })
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      .catch(() => resolve())
  })
}

export async function getCachedSectionStats(serviceId: string): Promise<any | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly')
      const req = tx.objectStore(CACHE_STORE).get(`stats_${serviceId}`)
      req.onsuccess = () => resolve(req.result?.data ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Sequential Sync Engine (FIFO)
 *
 * Replays every queued entry one-by-one over /api/attendance/toggle with client-generated id.
 * Sequential processing avoids flooding the network/server if many changes accumulated.
 */
export async function processAttendanceSync(
  getAuthToken: () => Promise<string | null>,
  onProgress?: (pendingCount: number, isSyncing: boolean) => void
): Promise<{
  total: number
  synced: number
  failed: number
  hasPersistentErrors: boolean
}> {
  // Prevent overlapping sync executions
  if (isSyncRunning) {
    const currentCount = await getQueuedCount()
    return { total: currentCount, synced: 0, failed: 0, hasPersistentErrors: false }
  }

  // Check browser online status
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const count = await getQueuedCount()
    onProgress?.(count, false)
    return { total: count, synced: 0, failed: 0, hasPersistentErrors: false }
  }

  isSyncRunning = true

  try {
    const queue = await getQueuedAttendance()
    if (queue.length === 0) {
      onProgress?.(0, false)
      return { total: 0, synced: 0, failed: 0, hasPersistentErrors: false }
    }

    onProgress?.(queue.length, true)

    const token = await getAuthToken()
    if (!token) {
      // Cannot sync without a valid session
      onProgress?.(queue.length, false)
      return { total: queue.length, synced: 0, failed: queue.length, hasPersistentErrors: false }
    }

    // Sort by timestamp ascending to preserve FIFO modification order
    queue.sort((a, b) => a.updatedAt - b.updatedAt)

    let synced = 0
    let failed = 0
    let hasPersistentErrors = false

    for (const item of queue) {
      // Abort if browser disconnected mid-sync
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break
      }

      try {
        const res = await fetch('/api/attendance/toggle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: item.id, // Client-generated unique id for deduplication
            serviceId: item.serviceId,
            personId: item.personId,
            isPresent: item.isPresent,
          }),
        })

        if (res.ok) {
          await dequeueAttendance(item.key)
          synced++
          const remaining = await getQueuedCount()
          onProgress?.(remaining, true)
        } else {
          const errData = await res.json().catch(() => null)
          const errorMsg = errData?.error || `HTTP ${res.status}`
          await recordQueueSyncFailure(item.key, errorMsg)
          failed++

          // If the item is permanently rejected (400 or 403, e.g. person deleted/inactive or wrong section),
          // dequeue it so the queue does not stay permanently wedged.
          if (res.status === 400 || res.status === 403) {
            await dequeueAttendance(item.key)
          }

          if ((item.retryCount || 0) + 1 >= 5) {
            hasPersistentErrors = true
          }

          // Back off on server error (500 or 429) rather than hammering
          if (res.status >= 500 || res.status === 429) {
            break
          }
        }
      } catch (networkError: any) {
        // Network drop during fetch
        await recordQueueSyncFailure(item.key, networkError.message || 'Network request failed')
        failed++
        break // Stop processing remaining items until connectivity is restored
      }
    }

    const finalCount = await getQueuedCount()
    onProgress?.(finalCount, false)

    return {
      total: queue.length,
      synced,
      failed,
      hasPersistentErrors,
    }
  } finally {
    isSyncRunning = false
  }
}
