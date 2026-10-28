'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import GraceAssemblyMark from '@/components/layout/GraceAssemblyMark'

const SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const

export default function StaffRequestPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [requestedRole, setRequestedRole] = useState<'attendance_staff' | 'attendance_admin'>('attendance_staff')
  const [requestedSection, setRequestedSection] = useState<string>('Adults & Youth')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError('Please provide your full name.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    if (!phone.trim()) {
      setError('Please provide your phone number.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/staff-requests/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          requestedRole,
          requestedSection,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || 'Failed to submit staff request. Please try again.')
        setLoading(false)
        return
      }

      setSubmitted(true)
    } catch {
      setError('Network connection error. Please check your internet and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen w-full bg-[#F7F3EC] flex flex-col justify-between py-10 px-6 sm:px-8 selection:bg-[#A8763E]/20">
      <div className="w-full max-w-[480px] mx-auto my-auto flex flex-col">
        {/* Brand header */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="flex items-center space-x-2.5 group">
            <GraceAssemblyMark size={22} />
            <span className="font-fraunces text-[18px] font-bold text-[#1F2A24] tracking-tight group-hover:text-[#A8763E] transition-colors">
              Grace Assembly
            </span>
          </Link>
          <Link
            href="/"
            className="text-[13px] text-[#4C6B52] hover:underline font-work-sans"
          >
            ← Back to Sign In
          </Link>
        </div>

        {submitted ? (
          <div className="bg-[#FAF8F5] border border-[#6B4226]/20 rounded-[14px] p-7 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] flex items-center justify-center mb-5 text-[24px]">
              ✓
            </div>
            <h1 className="font-fraunces text-[26px] font-bold text-[#1F2A24] mb-3">
              Request Submitted
            </h1>
            <p className="text-[15px] text-[#1F2A24]/75 font-work-sans leading-relaxed mb-4">
              Thank you, <strong className="text-[#1F2A24]">{fullName}</strong>. Your request to serve as{' '}
              <strong className="text-[#A8763E]">
                {requestedRole === 'attendance_admin' ? 'Attendance Admin' : 'Attendance Staff'}
              </strong>{' '}
              for the <strong className="text-[#1F2A24]">{requestedSection}</strong> section has been sent to
              church leadership (Super Admin) for review.
            </p>
            <div className="p-3.5 bg-[#A8763E]/10 rounded-[8px] border border-[#A8763E]/25 text-[#6B4226] text-[13px] leading-normal mb-6">
              ℹ️ Once leadership approves your request, you will be able to sign in directly using{' '}
              <strong>{email.toLowerCase()}</strong> via email OTP.
            </div>

            <Link
              href="/"
              className="inline-block w-full text-center bg-[#A8763E] text-[#F7F3EC] rounded-[10px] p-[14px] text-[15px] font-medium font-work-sans hover:bg-[#976835] transition-colors"
            >
              Return to Sign In
            </Link>
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <p className="text-[13px] uppercase font-bold tracking-wider text-[#A8763E] font-work-sans mb-1">
                Staff Onboarding
              </p>
              <h1 className="font-fraunces text-[32px] font-bold text-[#1F2A24] leading-tight mb-2 tracking-tight">
                Request Staff Access
              </h1>
              <p className="text-[15px] text-[#1F2A24]/65 font-work-sans leading-relaxed">
                Submit your serving details below. Requests are verified and approved by the Super Admin before access is granted.
              </p>
            </div>

            {error && (
              <div
                id="staff-request-error"
                role="alert"
                className="mb-6 p-3.5 rounded-[8px] bg-[#C94F3D]/10 border border-[#C94F3D]/25 text-[#C94F3D] text-[14px] leading-relaxed"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 bg-[#FAF8F5] border border-[#6B4226]/15 rounded-[14px] p-6 shadow-xs">
              {/* Full Name */}
              <div>
                <label
                  htmlFor="full-name-input"
                  className="block text-[13px] font-medium text-[#1F2A24]/80 mb-1.5 font-work-sans"
                >
                  Full Name <span className="text-[#C94F3D]">*</span>
                </label>
                <input
                  id="full-name-input"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Sister Grace Adeleke"
                  disabled={loading}
                  className="w-full bg-[#F7F3EC] border border-[#6B4226]/30 focus:border-[#A8763E] text-[#1F2A24] text-[15px] py-2.5 px-3 rounded-[8px] outline-none transition-colors placeholder:text-[#1F2A24]/30 disabled:opacity-60 font-work-sans"
                />
              </div>

              {/* Email Address */}
              <div>
                <label
                  htmlFor="email-input"
                  className="block text-[13px] font-medium text-[#1F2A24]/80 mb-1.5 font-work-sans"
                >
                  Email Address <span className="text-[#C94F3D]">*</span>
                </label>
                <input
                  id="email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={loading}
                  className="w-full bg-[#F7F3EC] border border-[#6B4226]/30 focus:border-[#A8763E] text-[#1F2A24] text-[15px] py-2.5 px-3 rounded-[8px] outline-none transition-colors placeholder:text-[#1F2A24]/30 disabled:opacity-60 font-work-sans"
                />
                <p className="text-[11px] text-[#1F2A24]/50 mt-1 font-work-sans">
                  This will be your sign-in email after approval.
                </p>
              </div>

              {/* Phone Number */}
              <div>
                <label
                  htmlFor="phone-input"
                  className="block text-[13px] font-medium text-[#1F2A24]/80 mb-1.5 font-work-sans"
                >
                  Phone Number <span className="text-[#C94F3D]">*</span>
                </label>
                <input
                  id="phone-input"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="080 1234 5678"
                  disabled={loading}
                  className="w-full bg-[#F7F3EC] border border-[#6B4226]/30 focus:border-[#A8763E] text-[#1F2A24] text-[15px] py-2.5 px-3 rounded-[8px] outline-none transition-colors placeholder:text-[#1F2A24]/30 disabled:opacity-60 font-work-sans"
                />
              </div>

              {/* Requested Role (ONLY Attendance Staff or Attendance Admin) */}
              <div>
                <label className="block text-[13px] font-medium text-[#1F2A24]/80 mb-2 font-work-sans">
                  Requested Role <span className="text-[#C94F3D]">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    id="role-select-attendance-staff"
                    onClick={() => setRequestedRole('attendance_staff')}
                    className={`py-2.5 px-3 text-left rounded-[8px] border transition-all cursor-pointer ${
                      requestedRole === 'attendance_staff'
                        ? 'border-[#A8763E] bg-[#A8763E]/10 text-[#1F2A24] ring-1 ring-[#A8763E]'
                        : 'border-[#6B4226]/30 bg-[#F7F3EC] text-[#1F2A24]/70 hover:border-[#6B4226]/60'
                    }`}
                  >
                    <div className="font-semibold text-[14px]">Attendance Staff</div>
                    <div className="text-[11px] text-[#1F2A24]/60">Section attendance marking</div>
                  </button>

                  <button
                    type="button"
                    id="role-select-attendance-admin"
                    onClick={() => setRequestedRole('attendance_admin')}
                    className={`py-2.5 px-3 text-left rounded-[8px] border transition-all cursor-pointer ${
                      requestedRole === 'attendance_admin'
                        ? 'border-[#A8763E] bg-[#A8763E]/10 text-[#1F2A24] ring-1 ring-[#A8763E]'
                        : 'border-[#6B4226]/30 bg-[#F7F3EC] text-[#1F2A24]/70 hover:border-[#6B4226]/60'
                    }`}
                  >
                    <div className="font-semibold text-[14px]">Attendance Admin</div>
                    <div className="text-[11px] text-[#1F2A24]/60">Member intake & roster approval</div>
                  </button>
                </div>
              </div>

              {/* Requested Assigned Section */}
              <div>
                <label
                  htmlFor="section-select"
                  className="block text-[13px] font-medium text-[#1F2A24]/80 mb-1.5 font-work-sans"
                >
                  Assigned Seating Section <span className="text-[#C94F3D]">*</span>
                </label>
                <select
                  id="section-select"
                  value={requestedSection}
                  onChange={(e) => setRequestedSection(e.target.value)}
                  disabled={loading}
                  className="w-full bg-[#F7F3EC] border border-[#6B4226]/30 focus:border-[#A8763E] text-[#1F2A24] text-[15px] py-2.5 px-3 rounded-[8px] outline-none transition-colors disabled:opacity-60 font-work-sans"
                >
                  {SECTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#1F2A24]/50 mt-1 font-work-sans">
                  The primary auditorium section you will cover during Sunday service.
                </p>
              </div>

              {/* Submit Button */}
              <button
                id="submit-staff-request-button"
                type="submit"
                disabled={loading}
                className="w-full bg-[#A8763E] text-[#F7F3EC] rounded-[10px] p-[15px] text-[15px] font-semibold font-work-sans hover:bg-[#976835] active:bg-[#855b2e] disabled:opacity-60 transition-colors cursor-pointer shadow-xs mt-2"
              >
                {loading ? 'Submitting Request…' : 'Submit Access Request'}
              </button>
            </form>
          </div>
        )}
      </div>

      <footer className="w-full max-w-[480px] mx-auto pt-8 pb-2 text-center">
        <p className="text-[#1F2A24]/50 text-[12px] font-work-sans">
          Grace Assembly Church Management &copy; 2026
        </p>
      </footer>
    </main>
  )
}
