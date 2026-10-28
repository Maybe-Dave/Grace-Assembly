'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import PageHeader from '@/components/layout/PageHeader'

interface UsherInfo {
  id: string
  name: string
  marksCount: number
}

interface SectionBreakdown {
  section: string
  present: number
  total: number
  percent: number
  ushers: UsherInfo[]
}

interface ActiveServiceData {
  id: string
  type: string
  serviceDate: string
  serviceTime: string
  combinedTotal: number
  combinedPresent: number
  combinedPercent: number
  sections: SectionBreakdown[]
}

interface HistoricalSectionStat {
  section: string
  present: number
  total: number
}

interface HistoricalService {
  id: string
  type: string
  serviceDate: string
  serviceTime: string
  combinedPresent: number
  combinedTotal: number
  percent: number
  sections: HistoricalSectionStat[]
}

function getOfflineStoredSession(): any | null {
  if (typeof window === 'undefined') return null
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const val = localStorage.getItem(key)
        if (val) {
          const parsed = JSON.parse(val)
          if (parsed && (parsed.access_token || parsed.currentSession?.access_token)) {
            return parsed.currentSession || parsed
          }
        }
      }
    }
  } catch {}
  return null
}

function formatDateDisplay(dateStr: string, timeStr?: string): string {
  try {
    const d = new Date(dateStr)
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }
    const dateFormatted = d.toLocaleDateString('en-US', options)
    if (!timeStr) return dateFormatted

    const [hours, minutes] = timeStr.split(':')
    const h = parseInt(hours, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const displayH = h % 12 || 12
    return `${dateFormatted} · ${displayH}:${minutes} ${ampm}`
  } catch {
    return dateStr
  }
}

export default function AdminAttendanceDashboard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authToken, setAuthToken] = useState('')
  const [userRole, setUserRole] = useState('')
  const [userEmail, setUserEmail] = useState('')

  // View tab: 'live' or 'history'
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live')

  // Live data
  const [activeService, setActiveService] = useState<ActiveServiceData | null>(null)
  const [historicalServices, setHistoricalServices] = useState<HistoricalService[]>([])
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch dashboard stats from API
  const fetchStats = useCallback(
    async (token: string, silent = false) => {
      if (!silent) setIsRefreshing(true)
      try {
        let activeToken = token
        try {
          const sessRes = await supabase.auth.getSession()
          if (sessRes.data?.session?.access_token) {
            activeToken = sessRes.data.session.access_token
          }
        } catch (_) {}

        const res = await fetch('/api/dashboard/stats', {
          headers: { Authorization: `Bearer ${activeToken}` },
        })

        // 401 Unauthorized: token expired or invalid
        if (res.status === 401) {
          // Attempt token refresh
          try {
            const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession()
            if (!refreshErr && refreshData?.session?.access_token) {
              const freshToken = refreshData.session.access_token
              setAuthToken(freshToken)
              const retryRes = await fetch('/api/dashboard/stats', {
                headers: { Authorization: `Bearer ${freshToken}` },
              })
              if (retryRes.ok) {
                const data = await retryRes.json()
                if (data.activeService) setActiveService(data.activeService)
                if (data.historicalServices) setHistoricalServices(data.historicalServices)
                if (data.userRole) setUserRole(data.userRole)
                setLastRefreshed(new Date())
                setError(null)
                return
              }
            }
          } catch (_) {}

          // Dev bypass auto-recovery in local dev environment
          if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true') {
            try {
              const devRes = await fetch('/api/auth/dev-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'super_admin' }),
              })
              if (devRes.ok) {
                const devData = await devRes.json()
                if (devData.session) {
                  await supabase.auth.setSession({
                    access_token: devData.session.access_token,
                    refresh_token: devData.session.refresh_token,
                  })
                  setAuthToken(devData.session.access_token)
                  return
                }
              }
            } catch (_) {}
          }

          // Stop polling on unresolvable 401 to prevent log spam
          if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current)
            pollingTimerRef.current = null
          }
          router.replace('/')
          return
        }

        if (res.status === 403) {
          if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current)
            pollingTimerRef.current = null
          }
          setUserRole('unauthorized')
          return
        }

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`)
        }

        const data = await res.json()
        if (data.activeService) {
          setActiveService(data.activeService)
        }
        if (data.historicalServices) {
          setHistoricalServices(data.historicalServices)
        }
        if (data.userRole) {
          setUserRole(data.userRole)
        }
        setLastRefreshed(new Date())
        setError(null)
      } catch (err: any) {
        console.error('Error fetching dashboard stats:', err)
        if (!silent) {
          setError('Failed to refresh dashboard. Re-attempting automatically…')
        }
      } finally {
        if (!silent) setIsRefreshing(false)
      }
    },
    [router]
  )

  // Session initialization
  useEffect(() => {
    async function init() {
      try {
        let session: any = null
        try {
          const sessRes = await supabase.auth.getSession()
          session = sessRes.data?.session
        } catch (_) {}

        if (!session) {
          session = getOfflineStoredSession()
        }

        // Dev login fallback
        if (!session) {
          try {
            const devRes = await fetch('/api/auth/dev-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'super_admin' }),
            })
            if (devRes.ok) {
              const devData = await devRes.json()
              session = devData.session
              if (session) {
                await supabase.auth.setSession({
                  access_token: session.access_token,
                  refresh_token: session.refresh_token,
                })
              }
            }
          } catch (_) {}
        }

        if (!session) {
          router.replace('/')
          return
        }

        setAuthToken(session.access_token)
        setUserEmail(session.user?.email || 'admin')

        // Fetch user role
        let role = 'super_admin'
        try {
          const profileRes = await fetch('/api/auth/me', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              email: session.user.email,
              userId: session.user.id,
            }),
          })
          if (profileRes.ok) {
            const profile = await profileRes.json()
            if (profile?.role) role = profile.role
          }
        } catch (_) {}

        setUserRole(role)

        if (['super_admin', 'attendance_admin'].includes(role)) {
          await fetchStats(session.access_token, false)
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, fetchStats])

  // Auto-refresh polling every 7 seconds while live view is active
  useEffect(() => {
    if (!authToken || !['super_admin', 'attendance_admin'].includes(userRole)) return

    if (activeTab === 'live') {
      pollingTimerRef.current = setInterval(() => {
        fetchStats(authToken, true)
      }, 7000)
    }

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current)
      }
    }
  }, [authToken, userRole, activeTab, fetchStats])

  // Sign out
  async function handleSignOut() {
    try {
      await supabase.auth.signOut()
    } finally {
      router.replace('/')
    }
  }

  if (loading) {
    return (
      <AppShell userRole={userRole} userEmail={userEmail}>
        <div className="flex items-center justify-center py-24 text-center">
          <p className="text-[15px] text-[#1F2A24]/65 font-work-sans">
            Loading Attendance Dashboard…
          </p>
        </div>
      </AppShell>
    )
  }

  // 403 Forbidden Access Gate: Only super_admin or attendance_admin can view
  if (!['super_admin', 'attendance_admin'].includes(userRole)) {
    return (
      <AppShell userRole={userRole} userEmail={userEmail}>
        <div className="w-full max-w-[480px] mx-auto py-16 px-4 text-center">
          <div className="bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] p-8 shadow-sm space-y-4">
            <div className="w-14 h-14 rounded-full bg-[#C94F3D]/12 text-[#C94F3D] flex items-center justify-center mx-auto text-[24px] font-bold">
              🔒
            </div>
            <h2 className="font-fraunces text-[22px] font-bold text-[#1F2A24]">
              Restricted Attendance Dashboard
            </h2>
            <p className="text-[14px] text-[#1F2A24]/75 leading-relaxed">
              Access to church-wide combined attendance is reserved exclusively for{' '}
              <strong>Super Admin</strong> and <strong>Attendance Admin</strong> roles.
              Your account is assigned the <strong>{userRole || 'staff'}</strong> role.
            </p>
            <div className="pt-2">
              <Link
                href="/attendance"
                id="return-attendance-button"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-[10px] bg-[#A8763E] text-[#FDFBF7] text-[14px] font-semibold hover:bg-[#976835] transition-colors shadow-2xs"
              >
                Return to Section Attendance
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell userRole={userRole} userEmail={userEmail}>
      <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col space-y-6">
        {/* Minimal Clean Header: Title + Subtitle only */}
        <PageHeader
          title="Attendance Dashboard"
          subtitle="Live executive turnout across all physical rooms and sections."
        />

        {/* Tab Navigation & Live Refresh Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#FDFBF7] p-2 rounded-[12px] border border-[#6B4226]/15 shadow-2xs">
          <div className="flex items-center gap-2">
            <button
              id="tab-live-service"
              type="button"
              onClick={() => setActiveTab('live')}
              className={`px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                activeTab === 'live'
                  ? 'bg-[#A8763E] text-[#FDFBF7] shadow-xs'
                  : 'text-[#1F2A24]/70 hover:text-[#1F2A24]'
              }`}
            >
              Live Service
            </button>
            <button
              id="tab-history"
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-[#A8763E] text-[#FDFBF7] shadow-xs'
                  : 'text-[#1F2A24]/70 hover:text-[#1F2A24]'
              }`}
            >
              Historical Trends
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 px-2 text-[12px] text-[#1F2A24]/65">
            {activeTab === 'live' && (
              <span className="inline-flex items-center gap-1.5 text-[#4C6B52] font-medium">
                <span className="w-2 h-2 rounded-full bg-[#4C6B52] animate-ping" />
                <span>Auto-refreshing (7s)</span>
              </span>
            )}

            <button
              id="manual-refresh-button"
              type="button"
              onClick={() => fetchStats(authToken, false)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#1F2A24]/5 hover:bg-[#1F2A24]/10 transition-colors cursor-pointer text-[12px] font-medium text-[#1F2A24]/80 disabled:opacity-50"
              title="Refresh attendance now"
            >
              <svg
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#A8763E]' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{isRefreshing ? 'Updating…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-[10px] bg-[#C94F3D]/10 border border-[#C94F3D]/25 text-[#C94F3D] text-[13px]">
            {error}
          </div>
        )}

        {/* =========================================================================
            TAB 1: LIVE IN-PROGRESS SERVICE VIEW
           ========================================================================= */}
        {activeTab === 'live' && activeService && (
          <div className="space-y-6">
            {/* 1. Combined Church-Wide Running Total Hero Card */}
            <section
              id="live-hero-card"
              className="bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[18px] p-6 shadow-sm flex flex-col space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#6B4226]/10 pb-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-bold text-[#A8763E]">
                    Current Service in Progress
                  </span>
                  <h2 className="font-fraunces text-[22px] font-bold text-[#1F2A24]">
                    {activeService.type}
                  </h2>
                  <p className="text-[13px] text-[#1F2A24]/65">
                    {formatDateDisplay(activeService.serviceDate, activeService.serviceTime)}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[11px] font-medium text-[#1F2A24]/50">
                    Combined Church Turnout
                  </span>
                  <div className="font-fraunces text-[32px] sm:text-[38px] font-bold text-[#A8763E] leading-none mt-0.5">
                    {activeService.combinedPercent}%
                  </div>
                </div>
              </div>

              {/* Running Total Big Display */}
              <div className="py-2">
                <div className="flex items-baseline gap-2">
                  <span
                    id="combined-present-count"
                    className="font-fraunces text-[36px] sm:text-[44px] font-bold text-[#1F2A24] tracking-tight leading-none"
                  >
                    {activeService.combinedPresent}
                  </span>
                  <span className="text-[18px] sm:text-[22px] font-semibold text-[#1F2A24]/55">
                    of {activeService.combinedTotal} marked present
                  </span>
                </div>
                <p className="text-[13px] text-[#1F2A24]/65 mt-1">
                  Total marked across <strong>Adults & Youth</strong>, <strong>Infants</strong>,{' '}
                  <strong>Older Children</strong>, and <strong>Teenagers</strong> combined.
                </p>
              </div>

              {/* Combined Progress Bar */}
              <div className="space-y-1.5">
                <div
                  className="w-full h-3.5 bg-[#1F2A24]/10 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={activeService.combinedPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-gradient-to-r from-[#A8763E] to-[#4C6B52] rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${activeService.combinedPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#1F2A24]/50 font-medium">
                  <span>0 attendees</span>
                  <span>{activeService.combinedTotal} total on active roster</span>
                </div>
              </div>
            </section>

            {/* 2. Breakdown Cards Per Section */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                  Section Breakdown & Active Ushers
                </h3>
                <span className="text-[12px] text-[#1F2A24]/60">
                  4 independent physical rooms
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeService.sections.map((sec) => (
                  <div
                    key={sec.section}
                    id={`section-card-${sec.section.toLowerCase().replace(/[\s&]/g, '-')}`}
                    className="bg-[#FDFBF7] border border-[#6B4226]/18 rounded-[16px] p-5 shadow-2xs flex flex-col justify-between space-y-4 hover:border-[#A8763E]/40 transition-colors"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-fraunces text-[17px] font-bold text-[#1F2A24]">
                            {sec.section}
                          </h4>
                          <span className="text-[12px] text-[#1F2A24]/60 font-work-sans">
                            Physical Seating Room
                          </span>
                        </div>
                        <span className="font-fraunces text-[20px] font-bold text-[#4C6B52]">
                          {sec.percent}%
                        </span>
                      </div>

                      {/* Section Progress ratio */}
                      <div className="mt-3 flex items-baseline gap-1.5">
                        <span className="text-[24px] font-bold text-[#1F2A24] font-work-sans leading-none">
                          {sec.present}
                        </span>
                        <span className="text-[15px] text-[#1F2A24]/55 font-medium">
                          of {sec.total}
                        </span>
                      </div>

                      <div className="w-full h-2 bg-[#1F2A24]/10 rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#4C6B52] rounded-full transition-all duration-300"
                          style={{ width: `${sec.percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Active Ushers Marking This Section */}
                    <div className="pt-3 border-t border-[#6B4226]/10">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1F2A24]/60 block mb-1.5">
                        Ushers Marking ({sec.ushers.length})
                      </span>

                      {sec.ushers.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sec.ushers.map((u) => (
                            <span
                              key={u.id}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-[#A8763E]/10 text-[#1F2A24] px-2.5 py-1 rounded-full border border-[#A8763E]/20"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-[#A8763E]" />
                              <span>{u.name}</span>
                              <span className="text-[10px] font-bold text-[#A8763E] bg-[#FDFBF7] px-1.5 py-0.2 rounded-full border border-[#A8763E]/30">
                                {u.marksCount}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-[#1F2A24]/50 italic">
                          No marks entered yet for this section today.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* =========================================================================
            TAB 2: HISTORICAL SERVICES VIEW & TRENDS
           ========================================================================= */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
                  Service Attendance History
                </h3>
                <p className="text-[13px] text-[#1F2A24]/65">
                  Final combined turnout and section breakdown across past services.
                </p>
              </div>
              <span className="text-[12px] font-medium text-[#A8763E] bg-[#A8763E]/10 px-2.5 py-1 rounded-full border border-[#A8763E]/20">
                {historicalServices.length} Recorded Services
              </span>
            </div>

            <div className="space-y-3">
              {historicalServices.map((svc) => (
                <div
                  key={svc.id}
                  id={`history-service-${svc.id}`}
                  className="bg-[#FDFBF7] border border-[#6B4226]/18 rounded-[16px] p-5 shadow-2xs space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#6B4226]/10 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                          {svc.type}
                        </h4>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#4C6B52]/12 text-[#4C6B52] border border-[#4C6B52]/20">
                          {formatDateDisplay(svc.serviceDate)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[11px] text-[#1F2A24]/50 block">Combined Total</span>
                        <span className="font-work-sans text-[18px] font-bold text-[#1F2A24]">
                          {svc.combinedPresent}{' '}
                          <span className="text-[13px] text-[#1F2A24]/55 font-normal">
                            / {svc.combinedTotal}
                          </span>
                        </span>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-[#A8763E]/12 border border-[#A8763E]/25 flex items-center justify-center font-fraunces font-bold text-[16px] text-[#A8763E]">
                        {svc.percent}%
                      </div>
                    </div>
                  </div>

                  {/* Section Breakdown Pills */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[12px]">
                    {svc.sections.map((sec) => {
                      const secPct =
                        sec.total > 0 ? Math.round((sec.present / sec.total) * 100) : 0
                      return (
                        <div
                          key={sec.section}
                          className="bg-[#F7F3EC] p-2.5 rounded-[10px] border border-[#6B4226]/12 space-y-1"
                        >
                          <div className="text-[11px] font-semibold text-[#1F2A24]/75 truncate">
                            {sec.section}
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className="font-bold text-[#1F2A24]">
                              {sec.present}{' '}
                              <span className="text-[10px] text-[#1F2A24]/50 font-normal">
                                / {sec.total}
                              </span>
                            </span>
                            <span className="text-[11px] font-semibold text-[#4C6B52]">
                              {secPct}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {historicalServices.length === 0 && (
                <div className="bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[14px] p-8 text-center text-[#1F2A24]/60">
                  No historical service attendance recorded yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
