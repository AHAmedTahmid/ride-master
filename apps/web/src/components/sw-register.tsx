'use client'

import { useEffect } from 'react'

/** Registers the PWA service worker (public/sw.js). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is best-effort; never break the app over it.
    })
  }, [])
  return null
}
