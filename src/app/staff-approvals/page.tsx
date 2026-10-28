'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import PageHeader from '@/components/layout/PageHeader'

interface PendingStaffRequest {
  id: string
  full_name: string
  email: string
  phone: string
  requested_role: 'attendance_staff' | 'attendance_admin' | 'usher' | 'head_usher'
  requested_section: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  created_at: string
}

const SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const

function getOfflineStoredSession(): any | null {
  if (typeof window === 'undefined') return null
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const val = localStorage.getItem(key)
        if (val) {
          let parsed = JSON.parse(val)
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed)
            } catch {}
          }
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
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

export default function StaffApprovalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authToken, setAuthToken] = useState('')
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')

  const [requests, setRequests] = useState<PendingStaffRequest[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    id: string
    type: 'approved' | 'rejected'
    message: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // In-flight adjustments per request card
  const [editMap, setEditMap] = useState<
    Record<string, { role: 'attendance_staff' | 'attendance_admin'; section: string; rejectReason?: string; isRejecting?: boolean }>
  >({})

  // Fetch pending staff requests
  const loadRequests = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/staff-requests/pending', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const list: PendingStaffRequest[] = data?.requests ?? []
        setRequests(list)

        // Initialize editMap with current requested defaults
        const initialEdits: Record<string, { role: 'attendance_staff' | 'attendance_admin'; section: string }> = {}
        for (const req of list) {
          const mappedRole = (req.requested_role === 'head_usher' || req.requested_role === 'attendance_admin')
            ? 'attendance_admin'
            : 'attendance_staff'
          initialEdits[req.id] = {
            role: mappedRole,
            section: req.requested_section,
          }
        }
        setEditMap(initialEdits)
      } else if (res.status === 403) {
        setUserRole('forbidden')
      }
    } catch (err) {
      console.error('Error loading pending staff requests:', err)
      setError('Unable to load staff requests. Please check your connection.')
    }
  }, [])

  // Initialize session & verify role (Gated strictly to super_admin only)
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

        if (!session) {
          router.replace('/')
          return
        }

        setAuthToken(session.access_token)
        setUserEmail(session.user?.email || '')

        // Verify role strictly with /api/auth/me
        let role = ''
        try {
          const profileRes = await fetch('/api/auth/me', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              email: session.user?.email,
              userId: session.user?.id,
            }),
          })
          if (profileRes.ok) {
            const profile = await profileRes.json()
            if (profile?.role) role = profile.role
            if (profile?.name) setUserName(profile.name)
          }
        } catch (_) {}

        setUserRole(role)

        // Strict role gate: ONLY 'super_admin'
        if (role === 'super_admin') {
          await loadRequests(session.access_token)
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, loadRequests])

  // Handle Approve
  async function handleApprove(req: PendingStaffRequest) {
    const edit = editMap[req.id] || {
      role: req.requested_role,
      section: req.requested_section,
    }

    setProcessingId(req.id)
    setError(null)
    setFeedback(null)

    try {
      const res = await fetch('/api/staff-requests/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          requestId: req.id,
          action: 'approve',
          approvedRole: edit.role,
          approvedSection: edit.section,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to approve staff request')
      }

      // Remove from pending list
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
      setFeedback({
        id: req.id,
        type: 'approved',
        message: `Approved ${req.full_name} as ${edit.role === 'attendance_admin' ? 'Attendance Admin' : 'Attendance Staff'} (${edit.section}). Activation email sent.`,
      })
    } catch (err: any) {
      setError(err?.message || 'Error approving request.')
    } finally {
      setProcessingId(null)
    }
  }

  // Handle Reject
  async function handleReject(req: PendingStaffRequest) {
    const edit = editMap[req.id]
    const reason = edit?.rejectReason?.trim() || ''

    setProcessingId(req.id)
    setError(null)
    setFeedback(null)

    try {
      const res = await fetch('/api/staff-requests/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          requestId: req.id,
          action: 'reject',
          rejectionReason: reason || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to reject staff request')
      }

      // Remove from pending list
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
      setFeedback({
        id: req.id,
        type: 'rejected',
        message: `Rejected access request from ${req.full_name}.`,
      })
    } catch (err: any) {
      setError(err?.message || 'Error rejecting request.')
    } finally {
      setProcessingId(null)
    }
  }

  if (loading) {
    return (
      <AppShell userRole={userRole} userName={userName} userEmail={userEmail}>
        <div className="flex items-center justify-center py-24 text-center">
          <p className="text-[15px] text-[#1F2A24]/65 font-work-sans">Loading staff approvals…</p>
        </div>
      </AppShell>
    )
  }

  // STRICT ROLE GATE: Super Admin ONLY.
  // Any other role (including attendance_admin, attendance_staff, finance_*, events_*) gets 403 Forbidden.
  if (userRole !== 'super_admin') {
    return (
      <AppShell userRole={userRole} userName={userName} userEmail={userEmail}>
        <div className="w-full max-w-[480px] mx-auto py-16 px-4 text-center">
          <div
            id="staff-approvals-403-card"
            className="bg-[#FAF8F5] border border-[#C94F3D]/30 rounded-[16px] p-8 shadow-sm space-y-4"
          >
            <div className="w-14 h-14 rounded-full bg-[#C94F3D]/10 text-[#C94F3D] flex items-center justify-center mx-auto text-[26px]">
              🚫
            </div>
            <span className="inline-block text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded bg-[#C94F3D]/15 text-[#C94F3D]">
              403 Forbidden
            </span>
            <h1 className="font-fraunces text-[24px] font-bold text-[#1F2A24]">
              Super Admin Gated Access
            </h1>
            <p className="text-[14px] text-[#1F2A24]/75 leading-relaxed">
              Staff account onboarding and role assignment is strictly reserved for the{' '}
              <strong>Super Admin</strong>. Domain admins (including Attendance Admin) and other staff roles are not permitted to review or approve staff accounts.
            </p>
            <div className="pt-3 flex flex-col sm:flex-row gap-2">
              <Link
                href="/attendance"
                className="flex-1 py-2.5 px-4 rounded-[10px] bg-[#A8763E] text-[#F7F3EC] text-[14px] font-medium font-work-sans hover:bg-[#976835] transition-colors"
              >
                Go to Attendance
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell userRole={userRole} userName={userName} userEmail={userEmail}>
      <div className="w-full max-w-5xl mx-auto py-2 flex-1 flex flex-col space-y-6">
        {/* Minimal Clean Header: Title + Subtitle only */}
        <PageHeader
          title="Staff Approvals"
          subtitle="Review and authorize staff onboarding and role permissions."
        />

        <div className="flex items-center justify-between text-[12px] bg-[#FDFBF7] p-3 rounded-[10px] border border-[#6B4226]/15 text-[#1F2A24]/75">
          <span>
            Pending Requests:{' '}
            <strong className="text-[#A8763E] font-bold text-[13px]">{requests.length}</strong>
          </span>
          <span className="text-[#1F2A24]/50">
            Approved staff immediately receive assigned role access upon email sign-in.
          </span>
        </div>
        <p className="text-[13.5px] text-[#1F2A24]/65 leading-normal">
          Review onboarding requests from volunteers desiring to serve on church staff.
          You may adjust the requested role or assigned section before approving.
        </p>

        {/* Global Feedback Banner */}
        {feedback && (
          <div
            id="staff-approval-feedback-banner"
            role="status"
            className={`mb-6 p-4 rounded-[10px] text-[14px] flex items-center justify-between border ${
              feedback.type === 'approved'
                ? 'bg-[#4C6B52]/10 border-[#4C6B52]/30 text-[#4C6B52]'
                : 'bg-[#6B4226]/10 border-[#6B4226]/30 text-[#6B4226]'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-[12px] font-bold px-2 py-1 rounded hover:bg-black/5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-[10px] bg-[#C94F3D]/10 border border-[#C94F3D]/25 text-[#C94F3D] text-[14px]"
          >
            {error}
          </div>
        )}

        {/* Pending Requests List */}
        {requests.length === 0 ? (
          <div className="bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] flex items-center justify-center mx-auto text-[22px]">
              ✓
            </div>
            <h2 className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
              All staff requests caught up
            </h2>
            <p className="text-[14px] text-[#1F2A24]/60 max-w-[380px] mx-auto">
              There are currently no pending staff access requests awaiting leadership review.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => {
              const edit = editMap[req.id] || {
                role: (req.requested_role === 'head_usher' || req.requested_role === 'attendance_admin') ? 'attendance_admin' : 'attendance_staff',
                section: req.requested_section,
                rejectReason: '',
                isRejecting: false,
              }
              const isBusy = processingId === req.id

              const requestedRoleLabel = (req.requested_role === 'head_usher' || req.requested_role === 'attendance_admin')
                ? 'Attendance Admin'
                : 'Attendance Staff'

              return (
                <div
                  key={req.id}
                  id={`staff-request-card-${req.id}`}
                  className="bg-[#FAF8F5] border border-[#6B4226]/20 rounded-[14px] p-5 sm:p-6 shadow-2xs transition-all hover:border-[#6B4226]/35"
                >
                  {/* Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 mb-4 border-b border-[#6B4226]/10">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
                          {req.full_name}
                        </h2>
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#A8763E]/12 text-[#A8763E] border border-[#A8763E]/25">
                          Requested: {requestedRoleLabel}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[13px] text-[#1F2A24]/70">
                        <span>✉️ {req.email}</span>
                        <span>📞 {req.phone}</span>
                      </div>
                    </div>
                    <span className="text-[12px] text-[#1F2A24]/50 font-work-sans">
                      Submitted {formatDate(req.created_at)}
                    </span>
                  </div>

                  {/* Adjustment Controls (Role & Section) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 bg-[#F7F3EC]/70 p-3.5 rounded-[10px] border border-[#6B4226]/10">
                    {/* Role Adjustment */}
                    <div>
                      <label className="block text-[12px] font-semibold text-[#1F2A24]/75 mb-1">
                        Approved Role:
                      </label>
                      <select
                        id={`role-adjust-${req.id}`}
                        value={edit.role}
                        onChange={(e) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [req.id]: {
                              ...prev[req.id],
                              role: e.target.value as 'attendance_staff' | 'attendance_admin',
                            },
                          }))
                        }
                        disabled={isBusy}
                        className="w-full bg-[#FAF8F5] border border-[#6B4226]/30 text-[#1F2A24] text-[13px] py-1.5 px-2.5 rounded-[6px] outline-none focus:border-[#A8763E]"
                      >
                        <option value="attendance_staff">Attendance Staff (Section attendance marking)</option>
                        <option value="attendance_admin">Attendance Admin (Intake & member approval)</option>
                      </select>
                    </div>

                    {/* Section Adjustment */}
                    <div>
                      <label className="block text-[12px] font-semibold text-[#1F2A24]/75 mb-1">
                        Assigned Seating Section:
                      </label>
                      <select
                        id={`section-adjust-${req.id}`}
                        value={edit.section}
                        onChange={(e) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [req.id]: {
                              ...prev[req.id],
                              section: e.target.value,
                            },
                          }))
                        }
                        disabled={isBusy}
                        className="w-full bg-[#FAF8F5] border border-[#6B4226]/30 text-[#1F2A24] text-[13px] py-1.5 px-2.5 rounded-[6px] outline-none focus:border-[#A8763E]"
                      >
                        {SECTIONS.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Reject Reason Form (if toggled) */}
                  {edit.isRejecting && (
                    <div className="mb-4 p-3 bg-[#C94F3D]/10 rounded-[8px] border border-[#C94F3D]/25">
                      <label className="block text-[12px] font-semibold text-[#C94F3D] mb-1">
                        Rejection Reason (internal audit log only, not shown to applicant):
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Ineligible or not yet completed church serving training"
                        value={edit.rejectReason || ''}
                        onChange={(e) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [req.id]: {
                              ...prev[req.id],
                              rejectReason: e.target.value,
                            },
                          }))
                        }
                        className="w-full bg-[#FAF8F5] border border-[#C94F3D]/40 text-[#1F2A24] text-[13px] py-1.5 px-2.5 rounded-[6px] outline-none mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          id={`confirm-reject-btn-${req.id}`}
                          onClick={() => handleReject(req)}
                          disabled={isBusy}
                          className="bg-[#C94F3D] text-[#F7F3EC] text-[12px] font-medium py-1.5 px-3 rounded-[6px] hover:bg-[#b04232] cursor-pointer"
                        >
                          Confirm Rejection
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditMap((prev) => ({
                              ...prev,
                              [req.id]: { ...prev[req.id], isRejecting: false },
                            }))
                          }
                          className="bg-transparent text-[#1F2A24]/70 text-[12px] py-1.5 px-2.5 rounded hover:bg-black/5 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  {!edit.isRejecting && (
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        id={`reject-btn-${req.id}`}
                        onClick={() =>
                          setEditMap((prev) => ({
                            ...prev,
                            [req.id]: { ...prev[req.id], isRejecting: true },
                          }))
                        }
                        disabled={isBusy}
                        className="text-[13px] text-[#C94F3D] hover:underline cursor-pointer disabled:opacity-50"
                      >
                        Reject Request
                      </button>

                      <button
                        type="button"
                        id={`approve-btn-${req.id}`}
                        onClick={() => handleApprove(req)}
                        disabled={isBusy}
                        className="bg-[#4C6B52] hover:bg-[#3f5a44] text-[#F7F3EC] rounded-[8px] py-2 px-5 text-[14px] font-semibold transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        {isBusy ? 'Activating…' : `Approve & Activate (${edit.role === 'attendance_admin' ? 'Attendance Admin' : 'Attendance Staff'})`}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
