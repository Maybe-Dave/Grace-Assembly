/**
 * Grace Assembly — Health-Check Page (/)
 *
 * No auth required. Confirms:
 * 1. Supabase connection is alive (displays unit count)
 * 2. PWA manifest and service worker are registered
 *
 * This is the ONLY page in Phase 1. No navigation, no design system yet.
 */

import { Suspense } from 'react'
import { createClient } from '@supabase/supabase-js'

// -----------------------------------------------------------------------
// Supabase connectivity check (server-side, using anon key)
// -----------------------------------------------------------------------
async function getUnitCount(): Promise<{ count: number | null; error: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return {
      count: null,
      error: 'Environment variables not set (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    }
  }

  const supabase = createClient(url, key)
  const { count, error } = await supabase
    .from('units')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return { count: null, error: error.message }
  }

  return { count: count ?? 0, error: null }
}

// -----------------------------------------------------------------------
// Database section — the dynamic part, isolated so Suspense can stream it
// -----------------------------------------------------------------------
async function DatabaseStatus() {
  const { count, error } = await getUnitCount()

  const supabaseOk = error === null
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)'
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] ?? supabaseUrl

  return (
    <ul className="list-none space-y-1 text-sm">
      <li>
        <span className="font-medium">Project:</span>{' '}
        <code>{projectRef}</code>
      </li>
      <li>
        <span className="font-medium">Connection:</span>{' '}
        {supabaseOk ? (
          <span id="supabase-status" className="text-green-600 font-bold">
            ✅ OK
          </span>
        ) : (
          <span id="supabase-status" className="text-red-600 font-bold">
            ❌ FAILED — {error}
          </span>
        )}
      </li>
      {supabaseOk && (
        <li>
          <span className="font-medium">Units in database:</span>{' '}
          <span id="unit-count" className="font-bold">
            {count}
          </span>
        </li>
      )}
    </ul>
  )
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------
export default function HealthCheckPage() {
  return (
    <main className="min-h-screen p-8 font-mono">
      <h1 className="text-2xl font-bold mb-6">Grace Assembly — System Health</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Database (Supabase)</h2>
        <Suspense fallback={<p className="text-sm">Checking connection…</p>}>
          <DatabaseStatus />
        </Suspense>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">PWA</h2>
        <ul className="list-none space-y-1 text-sm">
          <li>
            <span className="font-medium">Manifest:</span>{' '}
            <a
              id="manifest-link"
              href="/manifest.json"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              /manifest.json
            </a>{' '}
            — verify in DevTools → Application → Manifest
          </li>
          <li>
            <span className="font-medium">Service Worker:</span>{' '}
            <span id="sw-status">
              Check DevTools → Application → Service Workers (should show
              &ldquo;/sw.js&rdquo; as activated)
            </span>
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Environment</h2>
        <ul className="list-none space-y-1 text-sm">
          <li>
            <span className="font-medium">NEXT_PUBLIC_SUPABASE_URL:</span>{' '}
            {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
              <span className="text-green-600">✅ set</span>
            ) : (
              <span className="text-red-600">❌ missing</span>
            )}
          </li>
          <li>
            <span className="font-medium">NEXT_PUBLIC_SUPABASE_ANON_KEY:</span>{' '}
            {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? (
              <span className="text-green-600">✅ set</span>
            ) : (
              <span className="text-red-600">❌ missing</span>
            )}
          </li>
          <li>
            <span className="font-medium">SUPABASE_SERVICE_ROLE_KEY:</span>{' '}
            {process.env.SUPABASE_SERVICE_ROLE_KEY ? (
              <span className="text-green-600">✅ set</span>
            ) : (
              <span className="text-red-600">❌ missing (only needed server-side)</span>
            )}
          </li>
        </ul>
      </section>

      <footer className="text-xs text-gray-400 mt-8">
        Grace Assembly Church Management App — Phase 1 Health Check
      </footer>
    </main>
  )
}