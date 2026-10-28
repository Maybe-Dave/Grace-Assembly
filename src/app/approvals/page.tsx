'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import PageHeader from '@/components/layout/PageHeader'

interface PendingPerson {
  id: string
  full_name: string
  phone: string
  section: string
  unit_name: string
  status_flag: 'first_time' | 'returning'
  submitted_by_name?: string
  submitted_by_section?: string
  created_at: string
  duplicate_matched_person_id?: string | null
  matched_person?: {
    id: string
    full_name: string
    phone?: string
    unit_name: string
    section: string
  } | null
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

export default function HeadUsherApprovalPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authToken, setAuthToken] = useState('')
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')

  const [pendingList, setPendingList] = useState<PendingPerson[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{
    id: string
    type: 'approved' | 'merged' | 'rejected'
    message: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch pending submissions
  const loadPendingList = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/intake/pending', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setPendingList(data?.pendingPeople ?? [])
      } else if (res.status === 403) {
        setUserRole('unauthorized')
      }
    } catch (err) {
      console.error('Error loading pending queue:', err)
      setError('Unable to load approval queue. Please check your connection.')
    }
  }, [])

  // Initialize session & verify head usher or admin role
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

        // Dev login fallback (development only — gated by build flag)
        if (!session && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true') {
          try {
            const devRes = await fetch('/api/auth/dev-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'attendance_admin' }),
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

        // Read user role from /api/auth/me
        let role = 'attendance_admin'
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
            if (profile?.name) setUserName(profile.name)
          }
        } catch (_) {}

        setUserRole(role)

        if (['super_admin', 'attendance_admin'].includes(role)) {
          await loadPendingList(session.access_token)
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, loadPendingList])

  // Handle Head Usher Action (Approve as New, Merge into Existing, Reject)
  async function handleAction(
    pendingPerson: PendingPerson,
    action: 'approve_new' | 'merge' | 'reject'
  ) {
    setProcessingId(pendingPerson.id)
    setError(null)
    setActionFeedback(null)

    try {
      const res = await fetch('/api/intake/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          pendingId: pendingPerson.id,
          action,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Action failed')
      }

      // Optimistic removal from queue list
      setPendingList((prev) => prev.filter((p) => p.id !== pendingPerson.id))

      const msg =
        action === 'approve_new'
          ? `Approved ${pendingPerson.full_name} as new member in ${pendingPerson.section}. Added to active directory!`
          : action === 'merge'
          ? `Merged ${pendingPerson.full_name} into existing directory record.`
          : `Rejected submission for ${pendingPerson.full_name}.`

      setActionFeedback({
        id: pendingPerson.id,
        type: action === 'approve_new' ? 'approved' : action === 'merge' ? 'merged' : 'rejected',
        message: msg,
      })
    } catch (err: any) {
      console.error('Error handling intake action:', err)
      setError(err?.message || 'Failed to complete approval action.')
    } finally {
      setProcessingId(null)
    }
  }

  if (loading) {
    return (
      <AppShell userRole={userRole} userName={userName}>
        <div className="flex items-center justify-center py-24 text-center">
          <p className="text-[15px] text-[#1F2A24]/65 font-work-sans">Loading approval queue…</p>
        </div>
      </AppShell>
    )
  }

  // Access control restriction: Only super_admin and attendance_admin can approve
  if (!['super_admin', 'attendance_admin'].includes(userRole)) {
    return (
      <AppShell userRole={userRole} userName={userName}>
        <div className="w-full max-w-[460px] mx-auto py-16 px-4 text-center">
          <div className="bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] p-6 shadow-sm space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#A8763E]/15 text-[#A8763E] flex items-center justify-center mx-auto text-[20px] font-bold">
              🔒
            </div>
            <h2 className="font-fraunces text-[22px] font-bold text-[#1F2A24]">
              Approval Access Required
            </h2>
            <p className="text-[14px] text-[#1F2A24]/70 leading-relaxed">
              Only accounts with the <strong>Super Admin</strong> or <strong>Attendance Admin</strong> role review and approve
              new person and visitor intake submissions.
            </p>
            <div className="pt-2">
              <Link
                href="/attendance"
                className="inline-block w-full py-2.5 px-4 rounded-[10px] bg-[#A8763E] text-[#F7F3EC] text-[14px] font-medium font-work-sans hover:bg-[#976835] transition-colors"
              >
                Return to Attendance Screen
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell userRole={userRole} userName={userName}>
      <div className="w-full max-w-5xl mx-auto py-2 flex-1 flex flex-col space-y-6">
        {/* Minimal Clean Header: Title + Subtitle only */}
        <PageHeader
          title="Intake Approvals Queue"
          subtitle="Review and verify visitor and new attendee intake records."
        />
        <div className="flex items-center justify-between text-[12px] bg-[#FDFBF7] p-3 rounded-[10px] border border-[#6B4226]/15 text-[#1F2A24]/75">
          <span>
            Pending Submissions:{' '}
            <strong className="text-[#A8763E] font-bold text-[13px]">{pendingList.length}</strong>
          </span>
          <span className="text-[#1F2A24]/50">
            Approved members are instantly added to their seating room attendance.
          </span>
        </div>

        {/* Feedback / Toast Banner */}
        {actionFeedback && (
          <div
            role="status"
            className={`mb-4 p-3.5 rounded-[10px] border text-[13px] flex items-center justify-between shadow-2xs ${
              actionFeedback.type === 'approved'
                ? 'bg-[#4C6B52]/12 border-[#4C6B52]/30 text-[#4C6B52]'
                : actionFeedback.type === 'merged'
                ? 'bg-[#A8763E]/12 border-[#A8763E]/30 text-[#A8763E]'
                : 'bg-[#1F2A24]/10 border-[#1F2A24]/20 text-[#1F2A24]'
            }`}
          >
            <span>{actionFeedback.message}</span>
            <button
              type="button"
              onClick={() => setActionFeedback(null)}
              className="text-xs underline font-medium cursor-pointer ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-[8px] bg-[#C94F3D]/10 border border-[#C94F3D]/30 text-[#C94F3D] text-[13px] flex items-center justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 2. Submissions Queue List */}
        <main className="flex-1 space-y-4">
          {pendingList.length === 0 ? (
            <div className="py-16 text-center bg-[#FDFBF7] rounded-[16px] border border-[#6B4226]/15 p-8">
              <div className="w-12 h-12 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] flex items-center justify-center mx-auto text-[22px] mb-3">
                ✓
              </div>
              <h3 className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                All Caught Up!
              </h3>
              <p className="text-[14px] text-[#1F2A24]/60 font-work-sans mt-1 max-w-[340px] mx-auto">
                No pending intake forms waiting for approval. New registrations from ushers will appear here.
              </p>
              <div className="mt-4">
                <Link
                  href="/attendance"
                  className="inline-block py-2 px-4 rounded-[8px] bg-[#A8763E] text-[#F7F3EC] text-[13px] font-medium font-work-sans hover:bg-[#976835] transition-colors"
                >
                  Return to Attendance
                </Link>
              </div>
            </div>
          ) : (
            pendingList.map((item) => {
              const isProcessing = processingId === item.id
              const hasDuplicate = Boolean(item.duplicate_matched_person_id || item.matched_person)
              const matched = item.matched_person

              return (
                <div
                  key={item.id}
                  className="bg-[#FDFBF7] border border-[#6B4226]/18 rounded-[14px] p-5 shadow-sm space-y-3.5 transition-all hover:border-[#6B4226]/30"
                >
                  {/* Item Header: Name + Attendee Status Pill */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-fraunces text-[18px] font-bold text-[#1F2A24] leading-snug">
                        {item.full_name}
                      </h2>
                      <div className="flex items-center gap-2 mt-1 text-[13px] text-[#1F2A24]/75">
                        <span className="font-medium text-[#1F2A24]">{item.phone}</span>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded-full bg-[#4C6B52]/12 text-[#4C6B52] text-[11px] font-medium">
                          {item.section}
                        </span>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded-full bg-[#A8763E]/12 text-[#A8763E] text-[11px] font-medium">
                          {item.unit_name}
                        </span>
                      </div>
                    </div>

                    {/* Status Flag */}
                    <span
                      className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                        item.status_flag === 'first_time'
                          ? 'bg-[#A8763E]/15 text-[#A8763E] border-[#A8763E]/30'
                          : 'bg-[#4C6B52]/15 text-[#4C6B52] border-[#4C6B52]/30'
                      }`}
                    >
                      {item.status_flag === 'first_time'
                        ? 'First-time visitor'
                        : 'Returning / known'}
                    </span>
                  </div>

                  {/* Submission Context */}
                  <div className="text-[12px] text-[#1F2A24]/55 flex items-center justify-between pt-1 border-t border-[#6B4226]/10">
                    <span>
                      Collected by{' '}
                      <strong className="text-[#1F2A24]/75">
                        {item.submitted_by_name || 'Usher'}
                      </strong>{' '}
                      ({item.submitted_by_section || item.section})
                    </span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>

                  {/* 3. Potential Duplicate Flag Banner & Side-by-Side Comparison */}
                  {hasDuplicate && (
                    <div className="p-3.5 rounded-[12px] bg-[#A8763E]/10 border border-[#A8763E]/35 space-y-3">
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#A8763E]">
                        <span>⚠️</span>
                        <span>Duplicate Phone Match Flagged at Intake</span>
                      </div>

                      <p className="text-[12px] text-[#1F2A24]/75 leading-relaxed">
                        This phone number is already registered to an active member. Review the existing record
                        below and decide whether to merge or confirm them as two separate people.
                      </p>

                      {/* Side-by-Side Comparison Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px] font-work-sans">
                        {/* Left: Submitted Record */}
                        <div className="p-2.5 rounded-[8px] bg-[#FDFBF7] border border-[#6B4226]/15">
                          <span className="block text-[10px] uppercase font-bold tracking-wider text-[#A8763E] mb-1">
                            New Intake Submission
                          </span>
                          <div className="font-semibold text-[#1F2A24]">{item.full_name}</div>
                          <div className="text-[#1F2A24]/70 mt-0.5">{item.phone}</div>
                          <div className="text-[#1F2A24]/70 mt-0.5">
                            {item.section} · {item.unit_name}
                          </div>
                        </div>

                        {/* Right: Existing Directory Record */}
                        <div className="p-2.5 rounded-[8px] bg-[#FDFBF7] border border-[#4C6B52]/30">
                          <span className="block text-[10px] uppercase font-bold tracking-wider text-[#4C6B52] mb-1">
                            Existing Directory Record
                          </span>
                          <div className="font-semibold text-[#1F2A24]">
                            {matched?.full_name || 'Existing Member'}
                          </div>
                          <div className="text-[#1F2A24]/70 mt-0.5">{matched?.phone || item.phone}</div>
                          <div className="text-[#1F2A24]/70 mt-0.5">
                            {matched?.section || 'Adults & Youth'} · {matched?.unit_name || 'Member'}
                          </div>
                        </div>
                      </div>

                      {/* Duplicate Specific Action Buttons */}
                      <div className="pt-1 flex items-center justify-end gap-2 flex-wrap">
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleAction(item, 'reject')}
                          className="px-3 py-1.5 rounded-[8px] border border-[#C94F3D]/30 text-[#C94F3D] hover:bg-[#C94F3D]/10 text-[12px] font-medium transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleAction(item, 'merge')}
                          className="px-3.5 py-1.5 rounded-[8px] bg-[#A8763E] hover:bg-[#976835] text-[#F7F3EC] text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
                        >
                          Merge into Existing Record
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleAction(item, 'approve_new')}
                          className="px-3.5 py-1.5 rounded-[8px] bg-[#4C6B52] hover:bg-[#3d5742] text-[#F7F3EC] text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
                        >
                          Confirm as Separate Person
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 4. Standard Action Buttons (when no duplicate flagged) */}
                  {!hasDuplicate && (
                    <div className="pt-2 flex items-center justify-end gap-2.5">
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAction(item, 'reject')}
                        className="px-3.5 py-2 rounded-[8px] border border-[#6B4226]/20 text-[#1F2A24]/75 hover:bg-[#1F2A24]/5 text-[13px] font-medium transition-colors cursor-pointer"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAction(item, 'approve_new')}
                        className="px-4 py-2 rounded-[8px] bg-[#4C6B52] hover:bg-[#3d5742] active:bg-[#2f4232] text-[#F7F3EC] text-[13px] font-semibold transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5"
                      >
                        {isProcessing ? (
                          <span>Processing…</span>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Approve as New Person</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </main>
      </div>
    </AppShell>
  )
}
