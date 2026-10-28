'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import GraceAssemblyMark from '@/components/layout/GraceAssemblyMark'

export default function WelcomeSignInPage() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', ''])
  const [greeting, setGreeting] = useState('Good morning')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const code = otp.join('')

  // Compute time-appropriate greeting on mount
  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 12) {
      setGreeting('Good morning')
    } else if (hour < 17) {
      setGreeting('Good afternoon')
    } else {
      setGreeting('Good evening')
    }
  }, [])

  // Auto-focus first OTP box when transitioning to otp step
  useEffect(() => {
    if (step === 'otp') {
      const timer = setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [step])

  // Cooldown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // If already authenticated, advance to /home
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/home')
      }
    })
  }, [router])

  // OTP input handlers for classic separate boxes
  function handleOtpChange(index: number, val: string) {
    const clean = val.replace(/\D/g, '')
    const nextOtp = [...otp]

    if (!clean) {
      nextOtp[index] = ''
      setOtp(nextOtp)
      return
    }

    const digits = clean.split('')
    if (digits.length === 1) {
      nextOtp[index] = digits[0]
      setOtp(nextOtp)
      if (error) setError(null)
      if (index < 5) {
        inputRefs.current[index + 1]?.focus()
      }
    } else {
      // Pasted or autofilled multiple digits
      digits.forEach((d, i) => {
        if (index + i < 6) {
          nextOtp[index + i] = d
        }
      })
      setOtp(nextOtp)
      if (error) setError(null)
      const nextIdx = Math.min(index + digits.length, 5)
      inputRefs.current[nextIdx]?.focus()
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        e.preventDefault()
        const nextOtp = [...otp]
        nextOtp[index - 1] = ''
        setOtp(nextOtp)
        inputRefs.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return

    const digits = pasted.split('')
    const nextOtp = ['', '', '', '', '', '']
    digits.forEach((d, i) => {
      if (i < 6) nextOtp[i] = d
    })
    setOtp(nextOtp)
    if (error) setError(null)

    const nextIdx = Math.min(digits.length, 5)
    inputRefs.current[nextIdx]?.focus()
  }

  // Step 1: Send OTP
  async function handleSendCode(e?: React.FormEvent | React.MouseEvent) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    setError(null)
    setResendMessage(null)

    const trimmedEmail = email.trim().toLowerCase()

    // 1. Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)

    try {
      // 2. Staff verification check before sending code
      const checkRes = await fetch('/api/auth/check-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      })

      const checkData = await checkRes.json().catch(() => null)

      if (!checkRes.ok || !checkData?.isStaff) {
        setError(
          checkData?.error ||
          "This email isn't registered as staff. Contact the church office."
        )
        setLoading(false)
        return
      }

      // 3. Send Supabase OTP without emailRedirectTo (sends 6-digit code)
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          shouldCreateUser: true,
        },
      })

      if (otpError) {
        const msg = otpError.message.toLowerCase()
        if (
          otpError.status === 429 ||
          otpError.code?.includes('rate_limit') ||
          msg.includes('security') ||
          msg.includes('rate limit')
        ) {
          setError('Too many sign-in attempts. Please wait a moment before trying again.')
        } else if (
          msg.includes('network') ||
          msg.includes('fetch')
        ) {
          setError('Unable to connect. Please check your internet connection and try again.')
        } else {
          setError('Unable to send code right now. Please try again or contact the church office.')
        }
        setLoading(false)
        return
      }

      // Transition to OTP verification step
      setStep('otp')
      setResendCooldown(30)
    } catch (err) {
      console.error('Sign-in error:', err)
      setError('Unable to connect. Please check your internet connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Verify OTP
  async function handleVerifyCode(e?: React.FormEvent | React.MouseEvent) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    setError(null)
    setResendMessage(null)

    const trimmedCode = code.trim()
    if (!trimmedCode || trimmedCode.length < 6) {
      setError('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: trimmedCode,
        type: 'email',
      })

      if (verifyError) {
        const msg = verifyError.message.toLowerCase()
        if (msg.includes('expired')) {
          setError("This code has expired. Please tap 'Resend code' to get a new one.")
        } else if (
          msg.includes('invalid') ||
          verifyError.status === 400 ||
          msg.includes('token')
        ) {
          setError('The code you entered is incorrect. Please check and try again.')
        } else if (msg.includes('network') || msg.includes('fetch')) {
          setError('Unable to connect. Please check your internet connection and try again.')
        } else {
          setError('Unable to verify code. Please check and try again.')
        }
        setLoading(false)
        return
      }

      // Synchronize staff role with auth user id
      if (data.user) {
        await fetch('/api/auth/me', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session?.access_token}`,
          },
          body: JSON.stringify({
            email: data.user.email,
            userId: data.user.id,
          }),
        }).catch(() => null)
      }

      // Successful verification -> navigate to /home
      router.push('/home')
    } catch (err) {
      console.error('Verify error:', err)
      setError('Unable to connect. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  // Resend code
  async function handleResendCode() {
    if (resendCooldown > 0 || loading) return
    setError(null)
    setResendMessage(null)
    setLoading(true)

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
        },
      })

      if (otpError) {
        const msg = otpError.message.toLowerCase()
        if (
          otpError.status === 429 ||
          otpError.code?.includes('rate_limit') ||
          msg.includes('security') ||
          msg.includes('rate limit')
        ) {
          setError('Too many sign-in attempts. Please wait a moment before trying again.')
        } else {
          setError('Unable to resend code right now. Please wait a moment.')
        }
      } else {
        setResendMessage('A new 6-digit code has been sent to your email.')
        setResendCooldown(30)
      }
    } catch {
      setError('Unable to connect. Please check your internet connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // 1-Click Development Sign-In (only compiled/callable when NEXT_PUBLIC_ENABLE_DEV_LOGIN=true)
  const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true'

  async function handleDevSignIn(role: string | null) {
    if (!DEV_LOGIN_ENABLED) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'dicksondave2002@gmail.com',
          role,
          section: 'Adults & Youth',
        }),
      })
      const data = await res.json()
      if (data?.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        })
        router.push('/home')
      } else {
        setError(data?.error || 'Dev login failed')
        setLoading(false)
      }
    } catch {
      setError('Unable to complete dev login.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen w-full bg-[#F7F3EC] flex flex-col justify-between py-10 px-6 sm:px-8 selection:bg-[#A8763E]/20">
      {/* Centered container with max-width for tablet/desktop */}
      <div className="w-full max-w-[420px] mx-auto my-auto flex flex-col">
        {/* 1. Grace Assembly brand mark + "Grace Assembly" wordmark in Fraunces bold, 18px */}
        <div className="flex items-center space-x-2.5 mb-10">
          <GraceAssemblyMark size={24} />
          <span className="font-fraunces text-[18px] font-bold text-[#1F2A24] tracking-tight">
            Grace Assembly
          </span>
        </div>

        {/* 2. "Good morning" (or time-appropriate greeting) in Work Sans, 14px, 60% opacity */}
        <p className="text-[14px] text-[#1F2A24]/60 font-work-sans mb-1 font-normal">
          {greeting}
        </p>

        {/* 3. "Welcome back" heading, Fraunces bold, 34px */}
        <h1 className="font-fraunces text-[34px] font-bold text-[#1F2A24] leading-tight mb-2 tracking-tight">
          Welcome back
        </h1>

        {/* 4. One sentence of supporting text, Work Sans, 15px, 65% opacity */}
        <p className="text-[15px] text-[#1F2A24]/65 font-work-sans mb-8 leading-normal">
          {step === 'email'
            ? 'Sign in with your registered church email to receive your sign-in code.'
            : `We sent a 6-digit verification code to ${email}.`}
        </p>

        {/* Error / Alert banner in #C94F3D (reserved for alerts/errors only) */}
        {error && (
          <div
            id="auth-error-banner"
            role="alert"
            className="mb-6 p-3.5 rounded-[8px] bg-[#C94F3D]/10 border border-[#C94F3D]/25 text-[#C94F3D] text-[14px] leading-relaxed"
          >
            {error}
          </div>
        )}

        {/* Success message on resend */}
        {resendMessage && (
          <div
            id="resend-success-banner"
            role="status"
            className="mb-6 p-3 rounded-[8px] bg-[#4C6B52]/10 border border-[#4C6B52]/25 text-[#4C6B52] text-[14px]"
          >
            {resendMessage}
          </div>
        )}

        {/* Form area */}
        {step === 'email' ? (
          <form
            action="javascript:void(0);"
            onSubmit={(e) => {
              e.preventDefault()
              handleSendCode(e)
            }}
            noValidate
            className="space-y-6"
          >
            {/* 5. Email input: label above, bottom-border-only style, placeholder you@example.com */}
            <div>
              <label
                htmlFor="email-input"
                className="block text-[13px] font-medium text-[#1F2A24]/75 mb-2 font-work-sans"
              >
                Email address
              </label>
              <input
                id="email-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="you@example.com"
                disabled={loading}
                className="w-full bg-transparent border-0 border-b border-[#6B4226]/50 focus:border-[#A8763E] text-[#1F2A24] text-[16px] py-2.5 px-0 rounded-none outline-none transition-colors placeholder:text-[#1F2A24]/30 disabled:opacity-60 font-work-sans"
              />
            </div>

            {/* 6. "Send code" button: full width, #A8763E bg, #F7F3EC text, 10px radius, 16px padding */}
            <button
              id="send-code-button"
              type="submit"
              onClick={(e) => {
                e.preventDefault()
                handleSendCode(e)
              }}
              disabled={loading}
              className="w-full bg-[#A8763E] text-[#F7F3EC] rounded-[10px] p-[16px] text-[16px] font-medium font-work-sans hover:bg-[#976835] active:bg-[#855b2e] disabled:opacity-60 transition-colors cursor-pointer shadow-xs"
            >
              {loading ? 'Sending code…' : 'Send code'}
            </button>

            {/* Entry point for new staff onboarding */}
            <div className="pt-2 text-center">
              <span className="text-[14px] text-[#1F2A24]/65 font-work-sans">
                New usher or serving on team?{' '}
              </span>
              <a
                id="request-staff-access-link"
                href="/staff-request"
                className="text-[14px] font-semibold text-[#A8763E] hover:underline font-work-sans transition-colors inline-flex items-center gap-1"
              >
                Request staff access &rarr;
              </a>
            </div>
          </form>
        ) : (
          <form
            action="javascript:void(0);"
            onSubmit={(e) => {
              e.preventDefault()
              handleVerifyCode(e)
            }}
            noValidate
            className="space-y-6"
          >
            {/* 7. Second step: Classic 6-digit OTP boxes + Verify button + Resend code */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-[13px] font-medium text-[#1F2A24]/75 font-work-sans">
                  Verification code
                </label>
                <span className="text-[12px] text-[#1F2A24]/50 font-mono">
                  {otp.filter(Boolean).length}/6
                </span>
              </div>

              <div
                className="flex items-center justify-between gap-2 sm:gap-3"
                role="group"
                aria-label="6-digit verification code"
              >
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el
                    }}
                    id={`otp-box-${index}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={handleOtpPaste}
                    onFocus={(e) => e.target.select()}
                    disabled={loading}
                    aria-label={`Digit ${index + 1}`}
                    className={`w-11 sm:w-13 h-14 sm:h-15 text-center text-[22px] sm:text-[24px] font-mono font-semibold text-[#1F2A24] bg-[#F7F3EC] rounded-[10px] border-2 outline-none transition-all duration-150 ${error
                        ? 'border-[#C94F3D] text-[#C94F3D] focus:border-[#C94F3D] focus:ring-2 focus:ring-[#C94F3D]/20'
                        : digit
                          ? 'border-[#6B4226] bg-[#6B4226]/5 focus:border-[#A8763E] focus:ring-3 focus:ring-[#A8763E]/20'
                          : 'border-[#6B4226]/30 hover:border-[#6B4226]/60 focus:border-[#A8763E] focus:ring-3 focus:ring-[#A8763E]/20'
                      } disabled:opacity-60 shadow-xs`}
                  />
                ))}
              </div>
            </div>

            <button
              id="verify-button"
              type="submit"
              onClick={(e) => {
                e.preventDefault()
                handleVerifyCode(e)
              }}
              disabled={loading || code.trim().length < 6}
              className="w-full bg-[#A8763E] text-[#F7F3EC] rounded-[10px] p-[16px] text-[16px] font-medium font-work-sans hover:bg-[#976835] active:bg-[#855b2e] disabled:opacity-60 transition-colors cursor-pointer shadow-xs"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>

            {/* Resend code text link in #4C6B52 & Change email */}
            <div className="flex items-center justify-between text-[14px] pt-1">
              <button
                id="resend-code-button"
                type="button"
                onClick={handleResendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-[#4C6B52] hover:underline font-medium disabled:opacity-50 cursor-pointer"
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </button>

              <button
                id="change-email-button"
                type="button"
                onClick={() => {
                  setStep('email')
                  setOtp(['', '', '', '', '', ''])
                  setError(null)
                  setResendMessage(null)
                }}
                className="text-[#1F2A24]/60 hover:text-[#1F2A24] text-[13px] hover:underline cursor-pointer"
              >
                Change email
              </button>
            </div>
          </form>
        )}

        {/* Development Quick Bypass — only visible when NEXT_PUBLIC_ENABLE_DEV_LOGIN=true (never in production) */}
        {DEV_LOGIN_ENABLED && (
          <div className="mt-8 pt-6 border-t border-[#6B4226]/15 text-center">
            <p className="text-[11px] uppercase font-bold tracking-wider text-[#A8763E] mb-2.5">
              ⚡ Development Quick Access
            </p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                id="dev-login-super-admin-button"
                type="button"
                onClick={() => handleDevSignIn('super_admin')}
                disabled={loading}
                className="py-2 px-2 rounded-[8px] bg-[#A8763E]/12 hover:bg-[#A8763E]/20 text-[#A8763E] border border-[#A8763E]/30 text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                Super Admin
              </button>
              <button
                id="dev-login-attendance-admin-button"
                type="button"
                onClick={() => handleDevSignIn('attendance_admin')}
                disabled={loading}
                className="py-2 px-2 rounded-[8px] bg-[#6B4226]/12 hover:bg-[#6B4226]/20 text-[#6B4226] border border-[#6B4226]/30 text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                Attendance Admin
              </button>
              <button
                id="dev-login-attendance-staff-button"
                type="button"
                onClick={() => handleDevSignIn('attendance_staff')}
                disabled={loading}
                className="py-2 px-2 rounded-[8px] bg-[#4C6B52]/12 hover:bg-[#4C6B52]/20 text-[#4C6B52] border border-[#4C6B52]/30 text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                Attendance Staff
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                id="dev-login-unassigned-button"
                type="button"
                onClick={() => handleDevSignIn(null)}
                disabled={loading}
                className="py-1.5 px-2 rounded-[8px] bg-[#C94F3D]/10 hover:bg-[#C94F3D]/20 text-[#C94F3D] border border-[#C94F3D]/30 text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                No Role (role = NULL)
              </button>
              <button
                id="dev-login-finance-admin-button"
                type="button"
                onClick={() => handleDevSignIn('finance_admin')}
                disabled={loading}
                className="py-1.5 px-2 rounded-[8px] bg-[#4C6B52]/20 hover:bg-[#4C6B52]/30 text-[#1F2A24] border border-[#4C6B52]/40 text-[12px] font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                Finance Admin
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 8. Footer link: "Having trouble? Contact the church office" in #4C6B52, 13px */}
      <footer className="w-full max-w-[420px] mx-auto pt-10 pb-2 text-center">
        <a
          id="church-office-link"
          href="mailto:office@graceassembly.org"
          className="text-[#4C6B52] text-[13px] font-work-sans hover:underline transition-opacity"
        >
          Having trouble? Contact the church office
        </a>
      </footer>
    </main>
  )
}