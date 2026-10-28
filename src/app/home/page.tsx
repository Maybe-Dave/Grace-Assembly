'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import PageHeader from '@/components/layout/PageHeader'

interface ActiveService {
  id: string
  type: string
  service_date: string
  service_time: string
  status?: string
}

function formatDate(dateStr: string, timeStr?: string): string {
  try {
    const d = new Date(dateStr)
    const formatted = d.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return timeStr ? `${formatted} • ${timeStr.slice(0, 5)}` : formatted
  } catch {
    return dateStr
  }
}

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authToken, setAuthToken] = useState('')
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [assignedSection, setAssignedSection] = useState('Adults & Youth')

  // Active service state
  const [activeService, setActiveService] = useState<ActiveService | null>(null)
  const [isSessionActive, setIsSessionActive] = useState(false)

  // Quick stats state (reused for super_admin & attendance_admin)
  const [stats, setStats] = useState<any | null>(null)
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0)
  const [pendingStaffCount, setPendingStaffCount] = useState<number>(0)

  // Service session creation modal state
  const [showSessionModal, setShowSessionModal] = useState(false)
  const [sessionType, setSessionType] = useState('Sunday Service')
  const [sessionDate, setSessionDate] = useState('')
  const [sessionTime, setSessionTime] = useState('09:00')
  const [startingSession, setStartingSession] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionSuccess, setSessionSuccess] = useState<string | null>(null)

  const [todayFormatted, setTodayFormatted] = useState('')

  useEffect(() => {
    setSessionDate(new Date().toISOString().split('T')[0])
    setTodayFormatted(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    )
  }, [])

  // Fetch active service session
  const loadActiveService = useCallback(async () => {
    try {
      const res = await fetch('/api/services/active')
      if (res.ok) {
        const data = await res.json()
        if (data?.activeService) {
          setActiveService(data.activeService)
          setIsSessionActive(true)
          return data.activeService
        }
      }
    } catch (_) {}

    // Fallback check
    try {
      const res2 = await fetch('/api/attendance/service')
      if (res2.ok) {
        const data2 = await res2.json()
        if (data2?.service) {
          setActiveService(data2.service)
          setIsSessionActive(Boolean(data2.isActive))
          return data2.service
        }
      }
    } catch (_) {}

    setActiveService(null)
    setIsSessionActive(false)
    return null
  }, [])

  // Load stats if admin
  const loadDashboardStats = useCallback(async (token: string) => {
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
      if (res.status === 401) {
        try {
          const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession()
          if (!refreshErr && refreshData?.session?.access_token) {
            const freshToken = refreshData.session.access_token
            const retryRes = await fetch('/api/dashboard/stats', {
              headers: { Authorization: `Bearer ${freshToken}` },
            })
            if (retryRes.ok) {
              const data = await retryRes.json()
              setStats(data)
              return
            }
          }
        } catch (_) {}
        return
      }
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (_) {}
  }, [])

  // Initialize session
  useEffect(() => {
    async function init() {
      try {
        let session: any = null
        try {
          const sessRes = await supabase.auth.getSession()
          session = sessRes.data?.session
        } catch (_) {}

        if (!session) {
          router.replace('/')
          return
        }

        setAuthToken(session.access_token)
        setUserEmail(session.user?.email || '')

        let role = ''
        try {
          const profileRes = await fetch('/api/auth/me', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ email: session.user?.email, userId: session.user?.id }),
          })
          if (profileRes.ok) {
            const profile = await profileRes.json()
            if (profile?.role) role = profile.role
            if (profile?.name) setUserName(profile.name)
            if (profile?.assigned_section) setAssignedSection(profile.assigned_section)
          }
        } catch (_) {}

        setUserRole(role)

        await loadActiveService()

        // Load stats for admin roles
        if (role === 'super_admin' || role === 'attendance_admin') {
          await loadDashboardStats(session.access_token)
          // Also fetch queue counts
          fetch('/api/intake/pending', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
            .then((r) => r.json())
            .then((d) => setPendingQueueCount(d?.count || 0))
            .catch(() => {})

          if (role === 'super_admin') {
            fetch('/api/staff-requests/pending', {
              headers: { Authorization: `Bearer ${session.access_token}` },
            })
              .then((r) => r.json())
              .then((d) => setPendingStaffCount(d?.requests?.length || 0))
              .catch(() => {})
          }
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, loadActiveService, loadDashboardStats])

  // Start new service session action
  async function handleStartSession(e: React.FormEvent) {
    e.preventDefault()
    setSessionError(null)
    setSessionSuccess(null)
    setStartingSession(true)

    try {
      const res = await fetch('/api/services/active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          type: sessionType,
          serviceDate: sessionDate,
          serviceTime: sessionTime,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to start service session')
      }

      setActiveService(data.service)
      setIsSessionActive(true)
      setSessionSuccess(`Successfully started ${data.service.type} session! Ushers can now record attendance.`)
      setTimeout(() => {
        setShowSessionModal(false)
        setSessionSuccess(null)
      }, 1500)

      if (authToken && (userRole === 'super_admin' || userRole === 'attendance_admin')) {
        loadDashboardStats(authToken)
      }
    } catch (err: any) {
      setSessionError(err?.message || 'Error starting session.')
    } finally {
      setStartingSession(false)
    }
  }

  return (
    <AppShell userRole={userRole} userName={userName} userEmail={userEmail} assignedSection={assignedSection}>
      <div className="w-full max-w-6xl mx-auto">
        {/* Clean, Minimal Page Header */}
        <PageHeader
          title="Grace Assembly"
          subtitle={todayFormatted}
          actions={
            (userRole === 'attendance_admin' || userRole === 'super_admin') && (
              <button
                type="button"
                id="start-session-header-btn"
                onClick={() => setShowSessionModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#A8763E] hover:bg-[#976835] text-[#FDFBF7] text-[13.5px] font-semibold transition-colors shadow-2xs cursor-pointer"
              >
                <span>+ Start Service Session</span>
              </button>
            )
          }
        />

        {/* Loading State */}
        {loading ? (
          <div className="py-16 text-center text-[#1F2A24]/60 font-work-sans">
            <p>Loading home dashboard…</p>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {/* =========================================================================
                1. SUPER_ADMIN HOME VIEW: Combined Summary + Leadership Links
            ========================================================================= */}
            {userRole === 'super_admin' && (
              <div className="space-y-6">
                {/* Active Session Status Bar */}
                <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#A8763E] block mb-1">
                      {isSessionActive ? 'Active Service Session' : 'Service Status'}
                    </span>
                    <h2 className="font-fraunces text-[22px] font-bold text-[#1F2A24]">
                      {activeService ? activeService.type : 'No Service In Progress'}
                    </h2>
                    <p className="text-[13px] text-[#1F2A24]/65 mt-0.5">
                      {activeService
                        ? formatDate(activeService.service_date, activeService.service_time)
                        : 'No session active — start one below to begin Sunday service attendance.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      id="super-admin-start-session-btn"
                      onClick={() => setShowSessionModal(true)}
                      className="px-3.5 py-2 rounded-[8px] bg-[#A8763E] hover:bg-[#976835] text-[#FDFBF7] text-[13px] font-semibold transition-colors cursor-pointer shadow-2xs"
                    >
                      {isSessionActive ? 'Start New Session' : 'Start Session'}
                    </button>
                    <Link
                      href="/attendance"
                      className="px-3.5 py-2 rounded-[8px] bg-[#F7F3EC] hover:bg-[#6B4226]/10 border border-[#6B4226]/20 text-[#1F2A24] text-[13px] font-medium transition-colors"
                    >
                      Open Attendance
                    </Link>
                  </div>
                </div>

                {/* KPI Summary Cards Grid (Responsive: 1 col on mobile, 2 col on tablet, 4 col on desktop) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[12px] p-5 shadow-2xs">
                    <span className="text-[12px] font-medium text-[#1F2A24]/65 uppercase tracking-wide block mb-1">
                      Total Present
                    </span>
                    <p className="font-fraunces text-[32px] font-bold text-[#4C6B52]">
                      {stats?.currentService?.totalPresent ?? 0}
                    </p>
                    <p className="text-[12px] text-[#1F2A24]/50 mt-1">
                      across all 4 physical sections
                    </p>
                  </div>

                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[12px] p-5 shadow-2xs">
                    <span className="text-[12px] font-medium text-[#1F2A24]/65 uppercase tracking-wide block mb-1">
                      Turnout Rate
                    </span>
                    <p className="font-fraunces text-[32px] font-bold text-[#A8763E]">
                      {stats?.currentService?.overallPercent ?? 0}%
                    </p>
                    <p className="text-[12px] text-[#1F2A24]/50 mt-1">
                      of {stats?.currentService?.totalRoster ?? 0} active members
                    </p>
                  </div>

                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[12px] p-5 shadow-2xs">
                    <span className="text-[12px] font-medium text-[#1F2A24]/65 uppercase tracking-wide block mb-1">
                      Pending Staff
                    </span>
                    <p className="font-fraunces text-[32px] font-bold text-[#1F2A24]">
                      {pendingStaffCount}
                    </p>
                    <Link
                      href="/staff-approvals"
                      className="text-[12px] text-[#A8763E] hover:underline font-medium mt-1 inline-block"
                    >
                      Review staff requests &rarr;
                    </Link>
                  </div>

                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[12px] p-5 shadow-2xs">
                    <span className="text-[12px] font-medium text-[#1F2A24]/65 uppercase tracking-wide block mb-1">
                      Intake Queue
                    </span>
                    <p className="font-fraunces text-[32px] font-bold text-[#1F2A24]">
                      {pendingQueueCount}
                    </p>
                    <Link
                      href="/approvals"
                      className="text-[12px] text-[#4C6B52] hover:underline font-medium mt-1 inline-block"
                    >
                      Review visitor queue &rarr;
                    </Link>
                  </div>
                </div>

                {/* Quick Domain Management Hub */}
                <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-6 shadow-2xs space-y-4">
                  <h3 className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                    Super Admin Controls
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Link
                      href="/staff-approvals"
                      className="p-4 rounded-[10px] bg-[#F7F3EC] border border-[#6B4226]/15 hover:border-[#A8763E]/40 hover:bg-[#A8763E]/5 transition-all"
                    >
                      <h4 className="font-semibold text-[15px] text-[#1F2A24]">Staff Approvals</h4>
                      <p className="text-[12.5px] text-[#1F2A24]/65 mt-1">
                        Review onboarding requests and activate new staff accounts.
                      </p>
                    </Link>

                    <Link
                      href="/dashboard"
                      className="p-4 rounded-[10px] bg-[#F7F3EC] border border-[#6B4226]/15 hover:border-[#A8763E]/40 hover:bg-[#A8763E]/5 transition-all"
                    >
                      <h4 className="font-semibold text-[15px] text-[#1F2A24]">Analytics Dashboard</h4>
                      <p className="text-[12.5px] text-[#1F2A24]/65 mt-1">
                        Room-by-room charts, turnout trends, and historical services.
                      </p>
                    </Link>

                    <Link
                      href="/approvals"
                      className="p-4 rounded-[10px] bg-[#F7F3EC] border border-[#6B4226]/15 hover:border-[#A8763E]/40 hover:bg-[#A8763E]/5 transition-all"
                    >
                      <h4 className="font-semibold text-[15px] text-[#1F2A24]">Member Approvals</h4>
                      <p className="text-[12.5px] text-[#1F2A24]/65 mt-1">
                        Review intake records from ushers and merge duplicates.
                      </p>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================================================
                2. ATTENDANCE_ADMIN HOME VIEW: Start Session + Section Progress
            ========================================================================= */}
            {userRole === 'attendance_admin' && (
              <div className="space-y-6">
                {/* Active Session & Session Launcher Card */}
                <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-6 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-[#6B4226]/10">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#A8763E] block mb-1">
                        {isSessionActive ? 'Active Service Session' : 'Service Session Required'}
                      </span>
                      <h2 className="font-fraunces text-[24px] font-bold text-[#1F2A24]">
                        {activeService ? activeService.type : 'No Active Session'}
                      </h2>
                      <p className="text-[13.5px] text-[#1F2A24]/65 mt-1">
                        {activeService
                          ? formatDate(activeService.service_date, activeService.service_time)
                          : 'Ushers cannot record attendance until you start today’s service session.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        id="attendance-admin-start-session-btn"
                        onClick={() => setShowSessionModal(true)}
                        className="px-4 py-2.5 rounded-[10px] bg-[#A8763E] hover:bg-[#976835] text-[#FDFBF7] text-[14px] font-semibold transition-colors cursor-pointer shadow-2xs"
                      >
                        {isSessionActive ? 'Start New Session' : 'Start Service Session'}
                      </button>
                      <Link
                        href="/attendance"
                        className="px-4 py-2.5 rounded-[10px] bg-[#4C6B52] hover:bg-[#3f5a44] text-[#FDFBF7] text-[14px] font-semibold transition-colors shadow-2xs"
                      >
                        Enter Attendance
                      </Link>
                    </div>
                  </div>

                  {/* Section Breakdown Grid */}
                  <div>
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#1F2A24]/70 mb-3">
                      Live Section Progress
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'].map((sec) => {
                        const secData = stats?.currentService?.sectionBreakdown?.[sec] || { present: 0, total: 0 }
                        const pct = secData.total > 0 ? Math.round((secData.present / secData.total) * 100) : 0
                        return (
                          <div key={sec} className="p-3.5 rounded-[10px] bg-[#F7F3EC] border border-[#6B4226]/10">
                            <span className="text-[12px] font-medium text-[#1F2A24]/75 truncate block">
                              {sec}
                            </span>
                            <div className="flex items-baseline justify-between mt-1">
                              <span className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
                                {secData.present}{' '}
                                <span className="text-[13px] font-normal text-[#1F2A24]/50">
                                  / {secData.total}
                                </span>
                              </span>
                              <span className="text-[12px] font-bold text-[#4C6B52]">{pct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#1F2A24]/10 rounded-full mt-2 overflow-hidden">
                              <div
                                className="h-full bg-[#4C6B52] rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Queue Alert Card */}
                <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-5 flex items-center justify-between shadow-2xs">
                  <div>
                    <h3 className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                      Visitor Intake Review Queue
                    </h3>
                    <p className="text-[13px] text-[#1F2A24]/65 mt-0.5">
                      {pendingQueueCount > 0
                        ? `${pendingQueueCount} new member/visitor record(s) awaiting intake approval.`
                        : 'Intake approval queue is currently clear.'}
                    </p>
                  </div>
                  <Link
                    href="/approvals"
                    className="px-3.5 py-2 rounded-[8px] bg-[#A8763E]/15 hover:bg-[#A8763E]/25 text-[#A8763E] border border-[#A8763E]/30 text-[13px] font-semibold transition-colors shrink-0"
                  >
                    Open Queue ({pendingQueueCount})
                  </Link>
                </div>
              </div>
            )}

            {/* =========================================================================
                3. ATTENDANCE_STAFF HOME VIEW: Active Session & Scoped Section Action
            ========================================================================= */}
            {userRole === 'attendance_staff' && (
              <div className="space-y-6">
                {isSessionActive && activeService ? (
                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[16px] p-6 sm:p-8 shadow-xs space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-5 border-b border-[#6B4226]/10">
                      <div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#4C6B52]/15 text-[#4C6B52] mb-2 border border-[#4C6B52]/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4C6B52] animate-pulse" />
                          Session in Progress
                        </span>
                        <h2 className="font-fraunces text-[26px] sm:text-[30px] font-bold text-[#1F2A24] leading-tight">
                          {activeService.type}
                        </h2>
                        <p className="text-[14px] text-[#1F2A24]/70 mt-1">
                          {formatDate(activeService.service_date, activeService.service_time)}
                        </p>
                      </div>

                      <div className="sm:text-right">
                        <span className="text-[12px] text-[#1F2A24]/60 font-medium block">
                          Your Assigned Seating Room:
                        </span>
                        <span className="inline-block mt-0.5 font-fraunces text-[18px] font-bold text-[#A8763E]">
                          {assignedSection}
                        </span>
                      </div>
                    </div>

                    {/* Primary Call to Action */}
                    <div className="pt-2">
                      <Link
                        href="/attendance"
                        id="staff-go-to-attendance-btn"
                        className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-[12px] bg-[#A8763E] hover:bg-[#976835] active:bg-[#855b2e] text-[#FDFBF7] text-[16px] font-semibold transition-colors shadow-sm cursor-pointer"
                      >
                        <span>Go to Attendance ({assignedSection})</span>
                        <span aria-hidden="true">&rarr;</span>
                      </Link>
                    </div>
                  </div>
                ) : (
                  /* Reassuring Inactive State for Ushers */
                  <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[16px] p-8 sm:p-12 text-center space-y-4 shadow-2xs">
                    <div className="w-14 h-14 rounded-full bg-[#A8763E]/12 text-[#A8763E] flex items-center justify-center mx-auto text-[24px]">
                      ⏳
                    </div>
                    <h2 className="font-fraunces text-[24px] font-bold text-[#1F2A24]">
                      No active service session yet
                    </h2>
                    <p className="text-[14px] text-[#1F2A24]/70 max-w-[420px] mx-auto leading-relaxed">
                      Waiting for church leadership to start the service session. Once the session is
                      activated, your attendance marking sheet for{' '}
                      <strong className="text-[#1F2A24]">{assignedSection}</strong> will appear here
                      automatically.
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => loadActiveService()}
                        className="px-4 py-2 rounded-[8px] bg-[#F7F3EC] border border-[#6B4226]/25 text-[#1F2A24] text-[13px] font-medium hover:bg-[#6B4226]/5 transition-colors cursor-pointer"
                      >
                        ↻ Refresh Status
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* =========================================================================
                4. FUTURE DOMAIN PLACEHOLDERS (Finance & Events)
            ========================================================================= */}
            {(userRole.startsWith('finance_') || userRole.startsWith('events_')) && (
              <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[16px] p-8 sm:p-12 text-center space-y-4 shadow-2xs">
                <div className="w-14 h-14 rounded-full bg-[#4C6B52]/12 text-[#4C6B52] flex items-center justify-center mx-auto text-[26px]">
                  {userRole.startsWith('finance_') ? '💳' : '📅'}
                </div>
                <h2 className="font-fraunces text-[24px] font-bold text-[#1F2A24]">
                  {userRole.startsWith('finance_')
                    ? 'Finance & Contributions Module'
                    : 'Events & Ministry Calendar'}
                </h2>
                <p className="text-[14px] text-[#1F2A24]/70 max-w-[460px] mx-auto leading-relaxed">
                  Nothing here yet. This ministry module is scheduled for an upcoming release. Your
                  account credentials and permissions are configured and will activate automatically
                  once launched.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Start Service Session Modal (Attendance Admin & Super Admin) */}
      {showSessionModal && (
        <div
          role="dialog"
          aria-modal="true"
          id="start-service-session-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F2A24]/40 backdrop-blur-xs"
        >
          <div className="w-full max-w-[460px] bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#6B4226]/10">
              <h3 className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
                Start New Service Session
              </h3>
              <button
                type="button"
                onClick={() => setShowSessionModal(false)}
                className="text-[#1F2A24]/40 hover:text-[#1F2A24] p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-[13px] text-[#1F2A24]/70">
              Starting a new service session automatically closes any previous active session. Ushers’
              attendance sheets will immediately bind to this session.
            </p>

            {sessionSuccess && (
              <div className="p-3 bg-[#4C6B52]/10 border border-[#4C6B52]/30 text-[#4C6B52] text-[13px] rounded-[8px]">
                {sessionSuccess}
              </div>
            )}

            {sessionError && (
              <div className="p-3 bg-[#C94F3D]/10 border border-[#C94F3D]/30 text-[#C94F3D] text-[13px] rounded-[8px]">
                {sessionError}
              </div>
            )}

            <form onSubmit={handleStartSession} className="space-y-4">
              <div>
                <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
                  Service Title / Label
                </label>
                <input
                  type="text"
                  required
                  value={sessionType}
                  onChange={(e) => setSessionType(e.target.value)}
                  placeholder="e.g. Sunday Service, Midweek Service"
                  className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
                    Service Date
                  </label>
                  <input
                    type="date"
                    required
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    required
                    value={sessionTime}
                    onChange={(e) => setSessionTime(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSessionModal(false)}
                  className="px-4 py-2 rounded-[8px] text-[13px] text-[#1F2A24]/70 hover:bg-[#6B4226]/5 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="confirm-start-session-btn"
                  disabled={startingSession}
                  className="px-5 py-2 rounded-[8px] bg-[#A8763E] hover:bg-[#976835] text-[#FDFBF7] text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {startingSession ? 'Activating Session…' : 'Activate Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  )
}
