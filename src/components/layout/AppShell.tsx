'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

export interface AppShellProps {
  children: React.ReactNode
  userRole?: string
  userName?: string
  userEmail?: string
  assignedSection?: string
  pendingSyncCount?: number
  isOnline?: boolean
}

import GraceAssemblyMark from '@/components/layout/GraceAssemblyMark'

function formatRoleLabel(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'attendance_admin':
      return 'Attendance Admin'
    case 'attendance_staff':
      return 'Attendance Staff'
    case 'finance_admin':
      return 'Finance Admin'
    case 'finance_staff':
      return 'Finance Staff'
    case 'events_admin':
      return 'Events Admin'
    case 'events_staff':
      return 'Events Staff'
    default:
      return 'Staff Member'
  }
}

export default function AppShell({
  children,
  userRole: propRole,
  userName: propName,
  userEmail: propEmail,
  assignedSection: propSection,
  pendingSyncCount: propSyncCount = 0,
  isOnline: propOnline = true,
}: AppShellProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [role, setRole] = useState(propRole || '')
  const [name, setName] = useState(propName || '')
  const [email, setEmail] = useState(propEmail || '')
  const [section, setSection] = useState(propSection || '')
  const [syncCount, setSyncCount] = useState(propSyncCount)
  const [online, setOnline] = useState(propOnline)
  const [signingOut, setSigningOut] = useState(false)

  // Ensure any legacy collapsed state is cleared so sidebar is visible at all times
  useEffect(() => {
    try {
      localStorage.removeItem('ga_sidebar_collapsed')
    } catch (_) {}
  }, [])

  // Resolve session if props omitted
  useEffect(() => {
    if (propRole) setRole(propRole)
    if (propName) setName(propName)
    if (propEmail) setEmail(propEmail)
    if (propSection) setSection(propSection)
    setSyncCount(propSyncCount)
    setOnline(propOnline)
  }, [propRole, propName, propEmail, propSection, propSyncCount, propOnline])

  useEffect(() => {
    if (role) return
    async function loadUser() {
      try {
        const { data } = await supabase.auth.getSession()
        const sess = data?.session
        if (!sess) return
        setEmail(sess.user?.email || '')
        const res = await fetch('/api/auth/me', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sess.access_token}`,
          },
          body: JSON.stringify({ email: sess.user?.email, userId: sess.user?.id }),
        })
        if (res.ok) {
          const profile = await res.json()
          if (profile?.role) setRole(profile.role)
          if (profile?.name) setName(profile.name)
          if (profile?.assigned_section) setSection(profile.assigned_section)
        }
      } catch (_) {}
    }
    loadUser()
  }, [role])

  // Sign out handler
  async function handleSignOut() {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i)
          if (key && (key.startsWith('sb-') || key.includes('supabase') || key.includes('auth'))) {
            localStorage.removeItem(key)
          }
        }
      } catch (_) {}
    } finally {
      window.location.href = '/'
    }
  }

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // Define nav links with role gates
  // Driven strictly by the same role rules:
  // - Home: All roles
  // - Attendance: super_admin, attendance_admin, attendance_staff
  // - Intake: super_admin, attendance_admin, attendance_staff
  // - Approvals (Intake Queue): super_admin, attendance_admin
  // - Staff Approvals: super_admin ONLY
  // - Dashboard: super_admin, attendance_admin
  const navItems = [
    {
      label: 'Home',
      href: '/home',
      allowedRoles: [
        'super_admin',
        'attendance_admin',
        'attendance_staff',
        'finance_admin',
        'finance_staff',
        'events_admin',
        'events_staff',
      ],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      label: 'Attendance',
      href: '/attendance',
      allowedRoles: ['super_admin', 'attendance_admin', 'attendance_staff'],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      label: 'Intake',
      href: '/intake',
      allowedRoles: ['super_admin', 'attendance_admin', 'attendance_staff'],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      ),
    },
    {
      label: 'Approvals Queue',
      href: '/approvals',
      allowedRoles: ['super_admin', 'attendance_admin'],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      label: 'Staff Approvals',
      href: '/staff-approvals',
      allowedRoles: ['super_admin'],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      label: 'Dashboard',
      href: '/dashboard',
      allowedRoles: ['super_admin', 'attendance_admin'],
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
    },
  ]

  const visibleNav = navItems.filter((item) => !role || item.allowedRoles.includes(role))

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1F2A24] font-work-sans flex flex-col md:flex-row selection:bg-[#A8763E]/20">
      {/* Mobile Top Header (< 640px) */}
      <div className="md:hidden sticky top-0 z-40 bg-[#FDFBF7] border-b border-[#6B4226]/15 px-4 py-3 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            id="mobile-nav-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 -ml-1.5 text-[#1F2A24] hover:bg-[#6B4226]/5 rounded-[8px] cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            )}
          </button>
          <Link href="/home" className="flex items-center gap-2">
            <GraceAssemblyMark size={22} />
            <span className="font-fraunces text-[17px] font-bold text-[#1F2A24] tracking-tight">
              Grace Assembly
            </span>
          </Link>
        </div>

        {/* Mobile Quick Sync Status */}
        <div className="flex items-center gap-2">
          {syncCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#A8763E] bg-[#A8763E]/12 px-2 py-0.5 rounded-full border border-[#A8763E]/25">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A8763E] animate-pulse" />
              <span>{syncCount}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4C6B52] bg-[#4C6B52]/10 px-2 py-0.5 rounded-full border border-[#4C6B52]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4C6B52]" />
              <span>Synced</span>
            </span>
          )}
        </div>
      </div>

      {/* Mobile Menu Backdrop & Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-[#1F2A24]/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-[280px] max-w-[80vw] bg-[#FDFBF7] border-r border-[#6B4226]/15 h-full flex flex-col justify-between p-5 z-10 shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#6B4226]/10">
                <div className="flex items-center gap-2.5">
                  <GraceAssemblyMark size={22} />
                  <span className="font-fraunces text-[18px] font-bold text-[#1F2A24]">
                    Grace Assembly
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-[#1F2A24]/50 hover:text-[#1F2A24]"
                >
                  ✕
                </button>
              </div>

              {/* Mobile Nav Links */}
              <nav className="space-y-1">
                {visibleNav.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[14px] font-medium transition-colors ${
                        isActive
                          ? 'bg-[#A8763E]/15 text-[#A8763E] font-semibold border border-[#A8763E]/30'
                          : 'text-[#1F2A24]/75 hover:bg-[#6B4226]/5 hover:text-[#1F2A24]'
                      }`}
                    >
                      <span className={isActive ? 'text-[#A8763E]' : 'text-[#1F2A24]/60'}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </nav>
            </div>

            {/* Mobile Drawer Footer */}
            <div className="pt-4 border-t border-[#6B4226]/10 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] font-semibold text-[13px] flex items-center justify-center shrink-0">
                  {name ? name.slice(0, 2).toUpperCase() : 'GA'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#1F2A24] truncate">
                    {name || email || 'Staff'}
                  </p>
                  <p className="text-[11px] text-[#A8763E] font-medium truncate">
                    {formatRoleLabel(role)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full text-left py-2 px-3 rounded-[8px] text-[13px] font-medium text-[#C94F3D] hover:bg-[#C94F3D]/10 transition-colors cursor-pointer"
              >
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop & Tablet Persistent Left Sidebar — Visible at all times */}
      <aside
        id="app-sidebar"
        className="hidden md:flex flex-col justify-between shrink-0 bg-[#FDFBF7] border-r border-[#6B4226]/15 h-screen sticky top-0 z-30 select-none w-[240px] lg:w-[260px] p-4"
      >
        {/* Top: Brand Header */}
        <div>
          <div className="flex items-center pb-4 mb-4 border-b border-[#6B4226]/10">
            <Link href="/home" className="flex items-center gap-2.5 group overflow-hidden">
              <GraceAssemblyMark size={24} />
              <span className="font-fraunces text-[18px] font-bold text-[#1F2A24] tracking-tight truncate group-hover:text-[#A8763E] transition-colors">
                Grace Assembly
              </span>
            </Link>
          </div>

          {/* Navigation Items — Text & Icons Always Visible */}
          <nav className="space-y-1.5" aria-label="Main Navigation">
            {visibleNav.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  id={`nav-link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 text-[13.5px] font-medium rounded-[8px] transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#A8763E]/15 text-[#A8763E] font-semibold border border-[#A8763E]/30 shadow-2xs'
                      : 'text-[#1F2A24]/75 hover:bg-[#6B4226]/6 hover:text-[#1F2A24]'
                  }`}
                >
                  <span className={`shrink-0 ${isActive ? 'text-[#A8763E]' : 'text-[#1F2A24]/60'}`}>
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Bottom Section: Sync Status & User Profile */}
        <div className="pt-3 border-t border-[#6B4226]/10 space-y-2.5">
          {/* Sync Status Badge in Sidebar Footer */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-[#1F2A24]/50 uppercase tracking-wider">
              Sync Status
            </span>

            {syncCount > 0 ? (
              <span
                title={`${syncCount} updates queued for sync`}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#A8763E] bg-[#A8763E]/12 px-2 py-0.5 rounded-full border border-[#A8763E]/25"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8763E] animate-pulse" />
                <span>{syncCount} pending</span>
              </span>
            ) : (
              <span
                title="All attendance changes synced"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4C6B52] bg-[#4C6B52]/10 px-2 py-0.5 rounded-full border border-[#4C6B52]/20"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#4C6B52]" />
                <span>Synced</span>
              </span>
            )}
          </div>

          {/* User Profile Info Card */}
          <div className="p-2.5 rounded-[10px] bg-[#F7F3EC]/80 border border-[#6B4226]/10">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="w-8 h-8 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] font-semibold text-[12px] flex items-center justify-center shrink-0">
                {name ? name.slice(0, 2).toUpperCase() : 'GA'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[#1F2A24] truncate leading-tight">
                  {name || email || 'Staff'}
                </p>
                <p className="text-[10.5px] font-medium text-[#A8763E] truncate">
                  {formatRoleLabel(role)}
                </p>
              </div>
            </div>

            {section && (
              <p className="text-[10px] text-[#1F2A24]/55 truncate mb-2">
                Section: <strong className="text-[#1F2A24]/75">{section}</strong>
              </p>
            )}

            <button
              type="button"
              id="sidebar-signout-btn"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full text-center py-1.5 px-2 rounded-[6px] text-[11.5px] font-medium text-[#C94F3D] hover:bg-[#C94F3D]/10 transition-colors cursor-pointer border border-[#C94F3D]/20"
            >
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area — Responsive Breakpoints */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto pb-16 md:pb-0">
        <main className="flex-1 w-full px-5 sm:px-8 md:px-12 lg:px-16 py-6 sm:py-8 md:py-10">
          {children}
        </main>
      </div>

      {/* Mobile Persistent Bottom Bar — Visible at all times on small screens (< md) */}
      <nav
        id="mobile-bottom-nav"
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#FDFBF7] border-t border-[#6B4226]/15 px-2 py-1.5 flex items-center justify-around shadow-lg"
      >
        {visibleNav.slice(0, 4).map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-[8px] transition-colors ${
                isActive ? 'text-[#A8763E] font-semibold' : 'text-[#1F2A24]/65 hover:text-[#1F2A24]'
              }`}
            >
              <span className={`shrink-0 ${isActive ? 'text-[#A8763E]' : 'text-[#1F2A24]/60'}`}>
                {item.icon}
              </span>
              <span className="text-[10px] mt-0.5 truncate max-w-[64px]">{item.label}</span>
            </Link>
          )
        })}
        {visibleNav.length > 4 && (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center py-1 px-2 rounded-[8px] text-[#1F2A24]/65 hover:text-[#1F2A24] cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
            <span className="text-[10px] mt-0.5">More</span>
          </button>
        )}
      </nav>
    </div>
  )
}
