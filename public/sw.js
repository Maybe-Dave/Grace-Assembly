// Grace Assembly - PWA Service Worker
// Provides app shell caching for offline support while safely filtering non-HTTP schemes and API routes.

const CACHE_NAME = 'grace-assembly-v2'

// Files to cache on install (app shell)
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
]

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache skipped for missing resources:', err)
      })
    )
  )
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  )
  self.clients.claim()
})

// Fetch: network-first strategy with cache fallback
self.addEventListener('fetch', (event) => {
  // 1. Only handle GET requests
  if (event.request.method !== 'GET') return

  // 2. Strictly filter URL scheme: only http and https are supported by the Cache API
  let requestUrl
  try {
    requestUrl = new URL(event.request.url)
  } catch (_) {
    return
  }

  // Reject chrome-extension://, moz-extension://, data:, blob:, etc.
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return
  }

  // 3. Never cache dynamic backend API routes or Supabase auth/data endpoints
  if (
    requestUrl.pathname.startsWith('/api/') ||
    requestUrl.hostname.includes('supabase.co')
  ) {
    return
  }

  // 4. Only cache same-origin resources to prevent foreign-origin cache errors
  if (requestUrl.origin !== self.location.origin) {
    return
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful basic responses for the static app shell
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {})
          }).catch(() => {})
        }
        return response
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached
          // For navigation requests, fallback to root shell
          if (event.request.mode === 'navigate') {
            return caches.match('/').then((root) => root || new Response('Offline', { status: 503 }))
          }
          return new Response('Offline', { status: 503 })
        })
      })
  )
})
