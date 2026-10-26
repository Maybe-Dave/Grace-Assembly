// Grace Assembly - PWA Service Worker
// This service worker caches the app shell for offline support.

const CACHE_NAME = 'grace-assembly-v1'

// Files to cache on install (app shell)
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
]

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  // Activate immediately (don't wait for old SW to be idle)
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
  // Take control of all clients immediately
  self.clients.claim()
})

// Fetch: network-first strategy with cache fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and same-origin/CDN requests
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for the app shell
        if (response && response.status === 200) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })
        }
        return response
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached
          // For navigation requests, serve the cached root
          if (event.request.mode === 'navigate') {
            return caches.match('/')
          }
          return new Response('Offline', { status: 503 })
        })
      })
  )
})
