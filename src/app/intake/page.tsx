'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'

const ALL_SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const
const ALL_UNITS = [
  'Visitor',
  'Member',
  'Choir',
  'Ushers',
  'FWI',
  "Men's Fellowship",
  'Youth',
  'Children',
] as const

interface MatchedPerson {
  id: string
  full_name: string
  phone?: string
  unit_name: string
  section: string
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

export default function NewPersonIntakePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  // Current collector session context
  const [collectorName, setCollectorName] = useState('Staff Usher')
  const [collectorSection, setCollectorSection] = useState('Adults & Youth')
  const [collectorRole, setCollectorRole] = useState('usher')
  const [authToken, setAuthToken] = useState('')

  // Form Fields
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [section, setSection] = useState('Adults & Youth')
  const [unit, setUnit] = useState('Visitor')
  const [statusFlag, setStatusFlag] = useState<'first_time' | 'returning'>('first_time')

  // Live duplicate lookup state
  const [checkingPhone, setCheckingPhone] = useState(false)
  const [matchedDuplicate, setMatchedDuplicate] = useState<MatchedPerson | null>(null)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const phoneLookupTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
          session = getOfflineStoredSession()
        }

        // Dev auto-login fallback if unauthenticated in development
        if (!session) {
          try {
            const devRes = await fetch('/api/auth/dev-login', { method: 'POST' })
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

        if (session) {
          setAuthToken(session.access_token)
          // Fetch user profile for name & assigned_section
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
              if (profile?.name) setCollectorName(profile.name)
              if (profile?.assigned_section) {
                setCollectorSection(profile.assigned_section)
                setSection(profile.assigned_section)
              }
              if (profile?.role) setCollectorRole(profile.role)
            }
          } catch (_) {}
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Live phone lookup with debounce
  function handlePhoneChange(val: string) {
    setPhone(val)
    setMatchedDuplicate(null)

    if (phoneLookupTimeoutRef.current) {
      clearTimeout(phoneLookupTimeoutRef.current)
    }

    const cleaned = val.replace(/\D/g, '')
    if (cleaned.length < 7) {
      setCheckingPhone(false)
      return
    }

    setCheckingPhone(true)
    phoneLookupTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/intake/lookup-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: val }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data?.matched && data?.person) {
            setMatchedDuplicate(data.person)
          } else {
            setMatchedDuplicate(null)
          }
        }
      } catch (err) {
        console.error('Phone lookup error:', err)
      } finally {
        setCheckingPhone(false)
      }
    }, 350)
  }

  // Handle Form Submission -> Queues to pending_people
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!fullName.trim() || !phone.trim()) {
      setErrorMessage('Full name and phone number are required.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          section,
          unit,
          statusFlag,
          duplicateMatchedPersonId: matchedDuplicate?.id || null,
          collectorName,
          collectorSection,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to submit intake record.')
      }

      setSuccessMessage(
        `Intake form for ${fullName} submitted to the approval queue. The head usher will review and approve this record.`
      )

      // Reset form
      setFullName('')
      setPhone('')
      setMatchedDuplicate(null)
      setStatusFlag('first_time')
      setUnit('Visitor')
    } catch (err: any) {
      console.error('Intake submit error:', err)
      setErrorMessage(err?.message || 'Failed to submit intake form. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F3EC] flex items-center justify-center p-6">
        <p className="text-[15px] text-[#1F2A24]/65 font-work-sans">Loading intake form…</p>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1F2A24] font-work-sans flex flex-col justify-between selection:bg-[#A8763E]/20">
      <div className="w-full max-w-[540px] mx-auto px-5 py-6 flex-1 flex flex-col">
        {/* Top Navigation Bar */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#6B4226]/15">
          <Link
            href="/attendance"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4C6B52] hover:underline"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Attendance</span>
          </Link>

          {['head_usher', 'admin', 'pastor', 'secretary'].includes(collectorRole) && (
            <Link
              href="/approvals"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#A8763E] bg-[#A8763E]/12 px-2.5 py-1 rounded-full border border-[#A8763E]/25 hover:bg-[#A8763E]/20 transition-colors"
            >
              <span>Review Queue</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}
        </div>

        {/* 1. Header with Title & Non-Editable Usher Collector Context */}
        <header className="mb-6">
          <h1 className="font-fraunces text-[26px] font-bold text-[#1F2A24] leading-tight tracking-tight">
            New Person Intake
          </h1>
          <p className="text-[14px] text-[#1F2A24]/70 mt-1 leading-normal">
            Register visitors and new attendees during or after service. Submissions are queued for
            head usher review and approval.
          </p>

          {/* Collector Context Pill (Auto-filled, Not Editable) */}
          <div className="mt-3.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-[#FDFBF7] border border-[#6B4226]/20 text-[12px] text-[#1F2A24]/75 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-[#4C6B52]" />
            <span>
              Collected by <strong className="text-[#1F2A24] font-semibold">{collectorName}</strong> ·{' '}
              <span className="text-[#4C6B52] font-medium">{collectorSection}</span>
            </span>
          </div>
        </header>

        {/* Success Alert */}
        {successMessage && (
          <div
            role="alert"
            className="mb-5 p-4 rounded-[12px] bg-[#4C6B52]/12 border border-[#4C6B52]/30 text-[#1F2A24] text-[13px] flex items-start gap-3 shadow-2xs"
          >
            <div className="w-5 h-5 rounded-full bg-[#4C6B52] text-[#F7F3EC] flex items-center justify-center shrink-0 mt-0.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[#4C6B52]">{successMessage}</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSuccessMessage(null)}
                  className="text-xs text-[#1F2A24]/60 hover:underline cursor-pointer"
                >
                  Register another person
                </button>
                <Link
                  href="/attendance"
                  className="text-xs font-semibold text-[#A8763E] hover:underline"
                >
                  Go to attendance →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-[10px] bg-[#C94F3D]/10 border border-[#C94F3D]/30 text-[#C94F3D] text-[13px] flex items-center justify-between"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs underline font-medium cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 2. Intake Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-[#FDFBF7] border border-[#6B4226]/18 rounded-[16px] p-6 shadow-sm space-y-4.5"
        >
          {/* Full Name */}
          <div>
            <label htmlFor="intake-fullname" className="block text-[13px] font-semibold text-[#1F2A24] mb-1.5">
              Full Name <span className="text-[#C94F3D]">*</span>
            </label>
            <input
              id="intake-fullname"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Samuel Adebayo"
              className="w-full px-3.5 py-2.5 bg-[#F7F3EC] text-[#1F2A24] text-[15px] border border-[#6B4226]/25 rounded-[10px] outline-none focus:border-[#A8763E] focus:ring-2 focus:ring-[#A8763E]/15 placeholder:text-[#1F2A24]/35 transition-all shadow-2xs"
            />
          </div>

          {/* Phone Number with Live Duplicate Lookup */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="intake-phone" className="block text-[13px] font-semibold text-[#1F2A24]">
                Phone Number <span className="text-[#C94F3D]">*</span>
              </label>
              {checkingPhone && (
                <span className="text-[11px] text-[#A8763E] flex items-center gap-1 font-medium">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Checking record…</span>
                </span>
              )}
            </div>

            <input
              id="intake-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="e.g. 08012345678"
              className={`w-full px-3.5 py-2.5 bg-[#F7F3EC] text-[#1F2A24] text-[15px] border rounded-[10px] outline-none transition-all shadow-2xs ${
                matchedDuplicate
                  ? 'border-[#A8763E] focus:ring-2 focus:ring-[#A8763E]/20'
                  : 'border-[#6B4226]/25 focus:border-[#A8763E] focus:ring-2 focus:ring-[#A8763E]/15'
              }`}
            />

            {/* Non-Blocking Soft Duplicate Warning Banner */}
            {matchedDuplicate && (
              <div
                role="status"
                className="mt-2.5 p-3 rounded-[10px] bg-[#A8763E]/12 border border-[#A8763E]/35 text-[#1F2A24] text-[12px] leading-relaxed flex items-start gap-2.5"
              >
                <span className="text-[#A8763E] font-bold text-[14px] mt-0.5 select-none shrink-0">
                  ⚠️
                </span>
                <div className="flex-1">
                  <p>
                    <strong className="text-[#A8763E] font-semibold">{matchedDuplicate.full_name}</strong>{' '}
                    is already on record with this number ({matchedDuplicate.unit_name} · {matchedDuplicate.section}).
                  </p>
                  <p className="text-[#1F2A24]/75 mt-0.5">
                    Submitting anyway will flag both for the head usher to merge or confirm as separate people.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Seating Section (Default to Usher's Assigned Section) */}
          <div>
            <label htmlFor="intake-section" className="block text-[13px] font-semibold text-[#1F2A24] mb-1.5">
              Seating Section <span className="text-[#C94F3D]">*</span>
            </label>
            <select
              id="intake-section"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border border-[#6B4226]/25 rounded-[10px] outline-none focus:border-[#A8763E] cursor-pointer shadow-2xs font-medium"
            >
              {ALL_SECTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#1F2A24]/55 mt-1">
              Defaults to your current seating section ({collectorSection}).
            </p>
          </div>

          {/* Ministry Unit (Default to "Visitor") */}
          <div>
            <label htmlFor="intake-unit" className="block text-[13px] font-semibold text-[#1F2A24] mb-1.5">
              Ministry Role / Unit <span className="text-[#C94F3D]">*</span>
            </label>
            <select
              id="intake-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border border-[#6B4226]/25 rounded-[10px] outline-none focus:border-[#A8763E] cursor-pointer shadow-2xs font-medium"
            >
              {ALL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Status Toggle (First-time visitor vs Returning / known) */}
          <div>
            <span className="block text-[13px] font-semibold text-[#1F2A24] mb-1.5">
              Attendee Status Flag <span className="text-[#C94F3D]">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2 bg-[#F7F3EC] p-1 rounded-[12px] border border-[#6B4226]/20">
              <button
                type="button"
                onClick={() => setStatusFlag('first_time')}
                className={`py-2 px-3 text-[13px] font-medium rounded-[9px] transition-all cursor-pointer ${
                  statusFlag === 'first_time'
                    ? 'bg-[#A8763E] text-[#FDFBF7] font-semibold shadow-2xs'
                    : 'text-[#1F2A24]/75 hover:text-[#1F2A24]'
                }`}
              >
                First-time visitor
              </button>
              <button
                type="button"
                onClick={() => setStatusFlag('returning')}
                className={`py-2 px-3 text-[13px] font-medium rounded-[9px] transition-all cursor-pointer ${
                  statusFlag === 'returning'
                    ? 'bg-[#4C6B52] text-[#FDFBF7] font-semibold shadow-2xs'
                    : 'text-[#1F2A24]/75 hover:text-[#1F2A24]'
                }`}
              >
                Returning / known
              </button>
            </div>
            <p className="text-[11px] text-[#1F2A24]/55 mt-1">
              Hint stored for the head usher reviewing the intake queue.
            </p>
          </div>

          {/* Submit Button (Never disabled by duplicate warning) */}
          <div className="pt-2">
            <button
              id="submit-intake-button"
              type="submit"
              disabled={submitting || !fullName.trim() || !phone.trim()}
              className="w-full py-3 px-4 rounded-[10px] bg-[#A8763E] hover:bg-[#976835] active:bg-[#855b2e] text-[#F7F3EC] text-[15px] font-semibold font-work-sans cursor-pointer transition-colors shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-[#F7F3EC]" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Submitting to Queue…</span>
                </>
              ) : (
                <>
                  <span>Submit to Approval Queue</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <footer className="w-full max-w-[540px] mx-auto px-5 py-4 text-center text-[12px] text-[#1F2A24]/50 border-t border-[#6B4226]/10">
        Grace Assembly Church Management · Intake Submissions Queue
      </footer>
    </div>
  )
}
