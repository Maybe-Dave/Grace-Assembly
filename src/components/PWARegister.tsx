'use client'

import { useEffect } from 'react'

/**
 * PWARegister — registers the service worker after page load
 * to ensure zero contention with critical page assets.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    const registerSW = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // If a new worker is installed, trigger update check
          reg.onupdatefound = () => {
            const installingWorker = reg.installing
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New content is available
                }
              }
            }
          }
        })
        .catch(() => {
          // Silent fallback in environments that block service workers
        })
    }

    if (document.readyState === 'complete') {
      registerSW()
    } else {
      window.addEventListener('load', registerSW, { once: true })
      return () => window.removeEventListener('load', registerSW)
    }
  }, [])

  return null
}
