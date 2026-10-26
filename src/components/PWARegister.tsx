'use client'

import { useEffect } from 'react'

/**
 * PWARegister — registers the service worker on the client side.
 * Renders nothing; used purely for its side-effect in the root layout.
 */
export default function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service worker registered:', registration.scope)
        })
        .catch((error) => {
          console.error('[PWA] Service worker registration failed:', error)
        })
    }
  }, [])

  return null
}
