'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import {
  enqueueAttendance,
  getQueuedAttendance,
  getQueuedCount,
  cacheServiceData,
  getCachedServiceData,
  cacheDirectoryMembers,
  getCachedDirectoryMembers,
  cacheSectionStats,
  getCachedSectionStats,
  processAttendanceSync,
} from '@/lib/offline/attendanceQueue'

interface ChurchService {
  id: string
  type: string
  service_date: string
  service_time: string
}

interface MemberAttendance {
  id: string
  full_name: string
  unit_name: string | null
  section?: string
  is_present: boolean
}

interface RoomStats {
  total: number
  present: number
}

const ALL_SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const
type SectionType = (typeof ALL_SECTIONS)[number]

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

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatServiceDate(dateStr: string, timeStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hours, minutes] = timeStr.split(':').map(Number)
    const date = new Date(year, month - 1, day, hours, minutes)

    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
    const dayNum = date.getDate()
    const monthName = date.toLocaleDateString('en-US', { month: 'short' })
    const timeFormatted = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    return `${dayName}, ${dayNum} ${monthName} • ${timeFormatted}`
  } catch {
    return `${dateStr} • ${timeStr}`
  }
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
  } catch {
    // Non-blocking
  }
  return null
}

export default function AttendanceScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('Staff Usher')
  const [userRole, setUserRole] = useState<string>('usher')
  const [assignedSection, setAssignedSection] = useState<string>('Adults & Youth')
  const [selectedSection, setSelectedSection] = useState<string>('Adults & Youth')
  const [service, setService] = useState<ChurchService | null>(null)

  // Members list currently loaded for the active section/scope
  const [allMembers, setAllMembers] = useState<MemberAttendance[]>([])

  // Live running totals per room across the entire church
  const [roomStats, setRoomStats] = useState<Record<string, RoomStats>>({
    'Adults & Youth': { total: 0, present: 0 },
    'Infants': { total: 0, present: 0 },
    'Older Children': { total: 0, present: 0 },
    'Teenagers': { total: 0, present: 0 },
    total: { total: 0, present: 0 },
  })

  // Offline sync & connectivity state
  const [isOnline, setIsOnline] = useState<boolean>(true)
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [hasPersistentSyncError, setHasPersistentSyncError] = useState<boolean>(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [phoneSearchResults, setPhoneSearchResults] = useState<MemberAttendance[] | null>(null)
  const [searchingPhone, setSearchingPhone] = useState(false)

  // Intake Modal state
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState(false)
  const [visitorFullName, setVisitorFullName] = useState('')
  const [visitorPhone, setVisitorPhone] = useState('')
  const [visitorSection, setVisitorSection] = useState<string>('Adults & Youth')
  const [visitorUnit, setVisitorUnit] = useState<string>('Visitor')
  const [visitorStatusFlag, setVisitorStatusFlag] = useState<'first_time' | 'returning'>('first_time')
  const [savingVisitor, setSavingVisitor] = useState(false)
  const [visitorSuccessMsg, setVisitorSuccessMsg] = useState<string | null>(null)
  const [visitorMatchedDuplicate, setVisitorMatchedDuplicate] = useState<any | null>(null)
  const [checkingVisitorPhone, setCheckingVisitorPhone] = useState(false)
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0)

  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [showAdminRoomStats, setShowAdminRoomStats] = useState(false)

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const phoneLookupTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Sequential sync replay
  const triggerSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    const result = await processAttendanceSync(
      async () => {
        try {
          const timeoutPromise = new Promise<{ data: { session: null } }>((res) =>
            setTimeout(() => res({ data: { session: null } }), 1000)
          )
          const sessionRes = await Promise.race([supabase.auth.getSession(), timeoutPromise])
          if (sessionRes.data?.session?.access_token) {
            return sessionRes.data.session.access_token
          }
        } catch (_) {}
        const offlineSess = getOfflineStoredSession()
        return offlineSess?.access_token ?? null
      },
      (remainingCount, syncingState) => {
        setPendingSyncCount(remainingCount)
        setIsSyncing(syncingState)
      }
    )

    setHasPersistentSyncError(result.hasPersistentErrors)
  }, [])

  // 1. Load members & room stats for a given section
  const loadSectionMembers = useCallback(
    async (serviceId: string, sectionFilter: string, isMounted = true) => {
      try {
        let members: MemberAttendance[] = []
        let stats: Record<string, RoomStats> | null = null
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true

        if (online) {
          try {
            const res = await fetch('/api/attendance/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                serviceId,
                section: sectionFilter === 'All Sections' ? '' : sectionFilter,
                query: '',
              }),
            })
            if (res.ok) {
              const data = await res.json()
              members = data?.people ?? []
              stats = data?.stats ?? null

              // Cache both members and room stats in IndexedDB
              await cacheDirectoryMembers(serviceId, sectionFilter, members)
              if (stats) {
                await cacheSectionStats(serviceId, stats)
              }
            }
          } catch {
            // Network fallback
          }
        }

        // If no members from network (e.g. launched offline), read IndexedDB cache
        if (members.length === 0) {
          const cached = await getCachedDirectoryMembers(serviceId, sectionFilter)
          if (cached && cached.length > 0) {
            members = cached
          }
        }

        if (!stats) {
          const cachedStats = await getCachedSectionStats(serviceId)
          if (cachedStats) {
            stats = cachedStats
          }
        }

        // Overlay pending queue items
        const queued = await getQueuedAttendance()
        const queueMap = new Map(
          queued.filter((q) => q.serviceId === serviceId).map((q) => [q.personId, q.isPresent])
        )

        const merged = members.map((m) =>
          queueMap.has(m.id) ? { ...m, is_present: queueMap.get(m.id)! } : m
        )

        if (isMounted) {
          setAllMembers(merged)
          if (stats) setRoomStats(stats)
          setPendingSyncCount(queued.length)
        }
      } catch (err) {
        console.error('Error loading section members:', err)
        if (isMounted) {
          setError('Unable to load member directory for this section.')
        }
      }
    },
    []
  )

  // 2. Initial session setup
  useEffect(() => {
    let isMounted = true

    async function initSession() {
      try {
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true
        if (isMounted) setIsOnline(online)

        const initialQueuedCount = await getQueuedCount()
        if (isMounted) setPendingSyncCount(initialQueuedCount)

        let session: any = null
        if (online) {
          try {
            const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
              setTimeout(() => resolve({ data: { session: null } }), 1000)
            )
            const sessionRes = await Promise.race([supabase.auth.getSession(), timeoutPromise])
            session = sessionRes.data?.session
          } catch {
            session = null
          }
        }

        if (!session) {
          session = getOfflineStoredSession()
        }

        // Automatic dev login in development if unauthenticated (gated by build flag)
        if (!session && online && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true') {
          try {
            const devRes = await fetch('/api/auth/dev-login', { method: 'POST' })
            if (devRes.ok) {
              const devData = await devRes.json()
              if (devData.session) {
                session = devData.session
                await supabase.auth.setSession({
                  access_token: session.access_token,
                  refresh_token: session.refresh_token,
                })
              }
            }
          } catch (_) {}
        }

        if (!session) {
          if (isMounted) router.replace('/')
          return
        }

        if (isMounted) {
          setUserEmail(session.user?.email ?? 'Staff')
          setUserId(session.user?.id ?? '')
        }

        // Fetch profile to get role & assigned_section
        let role = 'usher'
        let assignedSec = 'Adults & Youth'

        if (online) {
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
              if (profile?.assigned_section) assignedSec = profile.assigned_section

              if (['head_usher', 'admin', 'pastor', 'secretary'].includes(role)) {
                fetch('/api/intake/pending', {
                  headers: { Authorization: `Bearer ${session.access_token}` },
                })
                  .then((r) => r.json())
                  .then((d) => {
                    if (d?.count !== undefined) setPendingQueueCount(d.count)
                  })
                  .catch(() => {})
              }
            }
          } catch {
            // Non-blocking offline fallback
          }
        }

        if (isMounted) {
          setUserRole(role)
          setAssignedSection(assignedSec)
          const initialScope = role === 'admin' ? 'All Sections' : assignedSec
          setSelectedSection(initialScope)
          setVisitorSection(role === 'admin' ? 'Adults & Youth' : assignedSec)
        }

        // Fetch active church service
        let activeService: ChurchService | null = null

        if (online) {
          try {
            const serviceRes = await fetch('/api/attendance/service')
            if (serviceRes.ok) {
              const serviceData = await serviceRes.json()
              if (serviceData?.service) {
                activeService = serviceData.service
                await cacheServiceData(serviceData.service)
              }
            }
          } catch {
            // Network failure fallback
          }
        }

        if (!activeService) {
          activeService = await getCachedServiceData()
        }

        if (isMounted && activeService) {
          setService(activeService)
          const initialScope = role === 'admin' ? 'All Sections' : assignedSec
          await loadSectionMembers(activeService.id, initialScope, isMounted)

          if (online && initialQueuedCount > 0) {
            triggerSync()
          }
        }
      } catch (err) {
        console.error('Attendance init error:', err)
        if (isMounted) {
          setError('Unable to load attendance session. Please check your connection.')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    initSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/')
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [router, triggerSync, loadSectionMembers])

  // Connectivity and Visibility listeners for offline detection and auto-sync
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      triggerSync()
    }

    function handleOffline() {
      setIsOnline(false)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true
        setIsOnline(online)
        getQueuedCount().then((count) => {
          setPendingSyncCount(count)
          if (online && count > 0) {
            triggerSync()
          }
        })
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [triggerSync])

  // Section switcher handler (for admins)
  async function handleSectionChange(newSection: string) {
    if (newSection === selectedSection || !service) return
    setSelectedSection(newSection)
    setSearchQuery('')
    setPhoneSearchResults(null)
    setSearchingPhone(false)
    setLoading(true)
    await loadSectionMembers(service.id, newSection, true)
    setLoading(false)
  }

  // Live search handler
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setSearchQuery(val)

    const hasDigits = /\d/.test(val)

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!hasDigits) {
      setPhoneSearchResults(null)
      setSearchingPhone(false)
      return
    }

    if (!service) return

    setSearchingPhone(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/attendance/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: service.id,
            section: selectedSection === 'All Sections' ? '' : selectedSection,
            query: val.trim(),
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setPhoneSearchResults(data?.people ?? [])
        }
      } catch (err) {
        console.error('Phone search error:', err)
      } finally {
        setSearchingPhone(false)
      }
    }, 200)
  }

  function handleClearSearch() {
    setSearchQuery('')
    setPhoneSearchResults(null)
    setSearchingPhone(false)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
  }

  // Synchronous instant client-side filtering
  const displayedPeople = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase()
    if (!trimmed) {
      return allMembers
    }

    const hasDigits = /\d/.test(trimmed)
    const tokens = trimmed.split(/\s+/).filter(Boolean)

    const clientMatches = allMembers.filter((person) => {
      const name = person.full_name.toLowerCase()
      const unit = (person.unit_name ?? '').toLowerCase()
      const sec = (person.section ?? '').toLowerCase()
      return tokens.every((t) => name.includes(t) || unit.includes(t) || sec.includes(t))
    })

    if (hasDigits && phoneSearchResults && phoneSearchResults.length > 0) {
      const seenIds = new Set(clientMatches.map((p) => p.id))
      const combined = [...clientMatches]
      for (const p of phoneSearchResults) {
        if (!seenIds.has(p.id)) {
          const existing = allMembers.find((m) => m.id === p.id)
          combined.push(existing ?? p)
          seenIds.add(p.id)
        }
      }
      return combined
    }

    return clientMatches
  }, [allMembers, searchQuery, phoneSearchResults])

  // Offline-first attendance toggle with client-generated mark ID
  async function handleToggle(person: MemberAttendance) {
    if (!service) return
    setError(null)

    const nextPresent = !person.is_present

    // 1. Instant optimistic UI update
    setAllMembers((prev) =>
      prev.map((p) => (p.id === person.id ? { ...p, is_present: nextPresent } : p))
    )

    setPhoneSearchResults((prev) =>
      prev ? prev.map((p) => (p.id === person.id ? { ...p, is_present: nextPresent } : p)) : null
    )

    // Optimistically update roomStats
    setRoomStats((prev) => {
      const secKey = person.section || 'Adults & Youth'
      const prevSec = prev[secKey] || { total: 0, present: 0 }
      const prevTot = prev.total || { total: 0, present: 0 }
      const delta = nextPresent ? 1 : -1

      return {
        ...prev,
        [secKey]: {
          ...prevSec,
          present: Math.max(0, prevSec.present + delta),
        },
        total: {
          ...prevTot,
          present: Math.max(0, prevTot.present + delta),
        },
      }
    })

    // 2. Queue in IndexedDB with client-generated UUID
    try {
      await enqueueAttendance(service.id, person.id, nextPresent)
      const count = await getQueuedCount()
      setPendingSyncCount(count)

      // Update cached directory
      getCachedDirectoryMembers(service.id, selectedSection).then((cached) => {
        if (cached) {
          const updated = cached.map((p) =>
            p.id === person.id ? { ...p, is_present: nextPresent } : p
          )
          cacheDirectoryMembers(service.id, selectedSection, updated)
        }
      })
    } catch (idbErr) {
      console.warn('IndexedDB write error:', idbErr)
    }

    // 3. Sequential FIFO network sync if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      triggerSync()
    }
  }

  // Live phone duplicate lookup for intake modal
  function handleVisitorPhoneChange(val: string) {
    setVisitorPhone(val)
    setVisitorMatchedDuplicate(null)

    if (phoneLookupTimeoutRef.current) {
      clearTimeout(phoneLookupTimeoutRef.current)
    }

    const cleaned = val.replace(/\D/g, '')
    if (cleaned.length < 7) {
      setCheckingVisitorPhone(false)
      return
    }

    setCheckingVisitorPhone(true)
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
            setVisitorMatchedDuplicate(data.person)
          } else {
            setVisitorMatchedDuplicate(null)
          }
        }
      } catch (err) {
        console.error('Phone lookup error:', err)
      } finally {
        setCheckingVisitorPhone(false)
      }
    }, 300)
  }

  // Submit intake form to pending approval queue (NOT a direct add to roster)
  async function handleCreateVisitor(e: React.FormEvent) {
    e.preventDefault()
    if (!visitorFullName.trim() || !visitorPhone.trim()) return

    setSavingVisitor(true)
    setError(null)

    try {
      let token = ''
      try {
        const sessRes = await supabase.auth.getSession()
        token = sessRes.data?.session?.access_token || ''
      } catch (_) {}
      if (!token) {
        const offlineSess = getOfflineStoredSession()
        token = offlineSess?.access_token || ''
      }

      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName: visitorFullName.trim(),
          phone: visitorPhone.trim(),
          section: visitorSection,
          unit: visitorUnit,
          statusFlag: visitorStatusFlag,
          duplicateMatchedPersonId: visitorMatchedDuplicate?.id || null,
          collectorName: userName,
          collectorSection: assignedSection,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to submit intake record')
      }

      setVisitorSuccessMsg(
        `Submitted ${visitorFullName} to Head Usher queue! They will appear on the active roster once approved.`
      )
      setVisitorFullName('')
      setVisitorPhone('')
      setVisitorMatchedDuplicate(null)
      setPendingQueueCount((c) => c + 1)
      setTimeout(() => {
        setVisitorSuccessMsg(null)
        setIsVisitorModalOpen(false)
      }, 1800)
    } catch (err: any) {
      console.error('Error submitting intake form:', err)
      setError(err?.message || 'Failed to submit intake form.')
    } finally {
      setSavingVisitor(false)
    }
  }

  // Sign out
  async function handleSignOut() {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
    } finally {
      router.replace('/')
    }
  }

  // Scoped section stats calculations
  const totalCount = allMembers.length
  const presentCount = allMembers.filter((p) => p.is_present).length
  const percent = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0

  // Display name for the currently selected section indicator
  const currentSectionLabel = selectedSection === 'All Sections' ? 'All Sections' : selectedSection

  if (loading && !service) {
    return (
      <main className="min-h-screen w-full bg-[#F7F3EC] flex items-center justify-center p-6">
        <p className="text-[15px] text-[#1F2A24]/65 font-work-sans">
          Loading attendance service…
        </p>
      </main>
    )
  }

  return (
    <div className="min-h-screen w-full bg-[#F7F3EC] text-[#1F2A24] font-work-sans flex flex-col justify-between selection:bg-[#A8763E]/20">
      <div className="w-full max-w-[640px] mx-auto flex-1 flex flex-col">
        {/* 1. Header with Service Info & User Badge */}
        <header className="sticky top-0 z-20 bg-[#FDFBF7] border-b border-[#6B4226]/15 px-5 py-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-fraunces text-[20px] font-bold text-[#1F2A24] leading-tight tracking-tight">
                  {service ? service.type : 'Sunday Service'}
                </h1>
                {userRole === 'admin' ? (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#A8763E]/15 text-[#A8763E] border border-[#A8763E]/30">
                    Admin
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#4C6B52]/12 text-[#4C6B52] border border-[#4C6B52]/20">
                      {assignedSection}
                    </span>
                    {/* Header Sync Status Indicator next to usher's section name */}
                    {pendingSyncCount > 0 ? (
                      <span
                        id="header-sync-status"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#A8763E] bg-[#A8763E]/12 px-2 py-0.5 rounded-full border border-[#A8763E]/25 animate-pulse"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A8763E]" />
                        <span>{pendingSyncCount} pending</span>
                      </span>
                    ) : (
                      <span
                        id="header-sync-status"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-[#4C6B52] bg-[#4C6B52]/10 px-2 py-0.5 rounded-full border border-[#4C6B52]/20"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4C6B52]" />
                        <span>Synced</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[13px] text-[#1F2A24]/60 font-work-sans mt-0.5">
                {service
                  ? formatServiceDate(service.service_date, service.service_time)
                  : 'Upcoming Service'}
              </p>
            </div>

            <div className="flex items-center space-x-2.5">
              {['admin', 'pastor', 'secretary'].includes(userRole) && (
                <Link
                  href="/dashboard"
                  id="dashboard-header-link"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4C6B52] bg-[#4C6B52]/12 px-2.5 py-1 rounded-full border border-[#4C6B52]/25 hover:bg-[#4C6B52]/20 transition-colors shadow-2xs"
                  title="Admin Combined Attendance Dashboard"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="9" />
                    <rect x="14" y="3" width="7" height="5" />
                    <rect x="14" y="12" width="7" height="9" />
                    <rect x="3" y="16" width="7" height="5" />
                  </svg>
                  <span>Dashboard</span>
                </Link>
              )}

              <Link
                href="/intake"
                id="intake-header-link"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4C6B52] bg-[#4C6B52]/10 px-2.5 py-1 rounded-full border border-[#4C6B52]/20 hover:bg-[#4C6B52]/20 transition-colors shadow-2xs"
                title="Full New Person Intake form"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Intake</span>
              </Link>

              {['head_usher', 'admin', 'pastor', 'secretary'].includes(userRole) && (
                <Link
                  href="/approvals"
                  id="review-queue-header-link"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#A8763E] bg-[#A8763E]/12 px-2.5 py-1 rounded-full border border-[#A8763E]/25 hover:bg-[#A8763E]/20 transition-colors shadow-2xs"
                  title="Head Usher Approval Queue"
                >
                  <span>Queue</span>
                  {pendingQueueCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-[#A8763E] text-[#FDFBF7] text-[10px] font-bold flex items-center justify-center">
                      {pendingQueueCount}
                    </span>
                  )}
                </Link>
              )}

              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-[12px] text-[#4C6B52] font-medium hover:underline cursor-pointer"
                title={`Signed in as ${userEmail} (${userRole})`}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>

              <div
                className="w-8 h-8 rounded-full bg-[#1F2A24]/5 flex items-center justify-center text-[#1F2A24]/50"
                aria-label="Staff profile active"
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
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Admin Room Running Totals Bar & Section Pills */}
          {userRole === 'admin' && (
            <div className="mt-3 pt-3 border-t border-[#6B4226]/10 space-y-2.5">
              {/* Section Switcher Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[12px] font-medium">
                {['All Sections', ...ALL_SECTIONS].map((sec) => {
                  const isActive = selectedSection === sec
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => handleSectionChange(sec)}
                      className={`whitespace-nowrap px-3 py-1 rounded-full transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#A8763E] text-[#FDFBF7] shadow-2xs font-semibold'
                          : 'bg-[#1F2A24]/6 hover:bg-[#1F2A24]/10 text-[#1F2A24]/75'
                      }`}
                    >
                      {sec}
                    </button>
                  )
                })}
              </div>

              {/* Admin Room-by-Room Live Running Totals Bar */}
              <div className="bg-[#F7F3EC] border border-[#6B4226]/15 rounded-[10px] p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1F2A24]/65">
                    Live Room Totals
                  </span>
                  <span className="text-[12px] font-bold text-[#A8763E]">
                    Church Total: {roomStats.total?.present || 0} / {roomStats.total?.total || 0}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                  {ALL_SECTIONS.map((sec) => {
                    const st = roomStats[sec] || { total: 0, present: 0 }
                    const secPct = st.total > 0 ? Math.round((st.present / st.total) * 100) : 0
                    return (
                      <div
                        key={sec}
                        className={`p-1.5 rounded-[6px] border ${
                          selectedSection === sec
                            ? 'bg-[#A8763E]/10 border-[#A8763E]/40 font-medium'
                            : 'bg-[#FDFBF7] border-[#6B4226]/10'
                        }`}
                      >
                        <div className="text-[11px] text-[#1F2A24]/70 truncate">{sec}</div>
                        <div className="text-[12px] font-bold text-[#1F2A24] flex items-center justify-between mt-0.5">
                          <span>
                            {st.present} / {st.total}
                          </span>
                          <span className="text-[10px] font-normal text-[#4C6B52]">{secPct}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Usher assigned section banner */}
          {userRole !== 'admin' && (
            <div className="mt-2.5 pt-2 border-t border-[#6B4226]/10 flex items-center justify-between text-[13px]">
              <span className="text-[#1F2A24]/70">
                Seating Room:{' '}
                <strong className="text-[#1F2A24] font-semibold">{assignedSection}</strong>
              </span>
              <span className="text-[11px] text-[#4C6B52] font-medium bg-[#4C6B52]/10 px-2 py-0.5 rounded-full">
                Dedicated Section Scoped
              </span>
            </div>
          )}
        </header>

        {/* Sub-header controls (Search & "New visitor" action) */}
        <section className="px-5 pt-3.5 pb-2.5 space-y-3 bg-[#F7F3EC]">
          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#1F2A24]/40">
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
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>

              <input
                id="search-people-input"
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={`Search ${
                  selectedSection === 'All Sections' ? 'all members' : selectedSection
                }…`}
                autoComplete="off"
                spellCheck={false}
                className="w-full pl-9 pr-8 py-2 bg-[#FDFBF7] text-[#1F2A24] text-[14px] font-work-sans border border-[#6B4226]/25 rounded-[10px] outline-none focus:border-[#A8763E] focus:ring-2 focus:ring-[#A8763E]/15 placeholder:text-[#1F2A24]/35 transition-all shadow-2xs"
              />

              {searchingPhone ? (
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-[#A8763E]">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </span>
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[#1F2A24]/40 hover:text-[#1F2A24] cursor-pointer"
                  aria-label="Clear search"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              ) : null}
            </div>

            {/* "New visitor" Action Button */}
            <button
              id="new-visitor-button"
              type="button"
              onClick={() => {
                setVisitorSection(
                  selectedSection === 'All Sections' ? assignedSection : selectedSection
                )
                setIsVisitorModalOpen(true)
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-[#A8763E]/40 bg-[#FDFBF7] hover:bg-[#A8763E]/10 active:bg-[#A8763E]/20 text-[#A8763E] text-[13px] font-semibold font-work-sans cursor-pointer transition-colors shadow-2xs shrink-0"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New person</span>
            </button>
          </div>
        </section>

        {/* Error notification banner */}
        {error && (
          <div
            role="alert"
            className="mx-5 mb-3 p-3 rounded-[8px] bg-[#C94F3D]/10 border border-[#C94F3D]/25 text-[#C94F3D] text-[13px] leading-relaxed flex items-center justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-[#C94F3D] ml-2 text-xs underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Member directory list */}
        <main className="flex-1 px-5 pb-6">
          {displayedPeople.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[15px] text-[#1F2A24]/60 font-work-sans">
                {searchingPhone
                  ? 'Searching directory by phone…'
                  : searchQuery
                  ? `No members found matching "${searchQuery}"`
                  : `No members found in section: ${currentSectionLabel}.`}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#6B4226]/10" role="list">
              {displayedPeople.map((person) => {
                const initials = getInitials(person.full_name)
                return (
                  <li
                    key={person.id}
                    className="py-3 flex items-center justify-between gap-3 transition-colors hover:bg-[#FDFBF7]/50 rounded-[8px] px-1"
                  >
                    {/* Left: Initials circle + Name + Unit & Section badges */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full bg-[#4C6B52]/15 text-[#4C6B52] font-semibold text-[14px] flex items-center justify-center shrink-0 tracking-wide select-none"
                        aria-hidden="true"
                      >
                        {initials}
                      </div>

                      <div className="min-w-0 flex flex-col">
                        <span className="text-[15px] sm:text-[16px] font-medium text-[#1F2A24] truncate leading-snug">
                          {person.full_name}
                        </span>

                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {/* Ministry Unit Pill */}
                          <span
                            className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
                              person.unit_name === 'Visitor'
                                ? 'bg-[#A8763E]/15 text-[#A8763E] font-semibold'
                                : 'bg-[#1F2A24]/6 text-[#1F2A24]/75'
                            }`}
                          >
                            {person.unit_name || 'Member'}
                          </span>

                          {/* Seating Section badge (displayed if viewing All Sections or admin) */}
                          {person.section && (
                            <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[#4C6B52]/10 text-[#4C6B52]">
                              {person.section}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Circular toggle on the right */}
                    <button
                      id={`toggle-person-${person.id}`}
                      type="button"
                      role="checkbox"
                      aria-checked={person.is_present}
                      aria-label={`Mark ${person.full_name} as ${
                        person.is_present ? 'absent' : 'present'
                      }`}
                      onClick={() => handleToggle(person)}
                      className="shrink-0 cursor-pointer p-1 -mr-1 outline-none focus:ring-2 focus:ring-[#A8763E]/30 rounded-full"
                    >
                      {person.is_present ? (
                        <div className="w-8 h-8 rounded-full bg-[#A8763E] border-2 border-[#A8763E] flex items-center justify-center text-[#F7F3EC] shadow-2xs transition-all hover:brightness-105 active:scale-95">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full border-2 border-[#6B4226]/40 bg-transparent flex items-center justify-center hover:border-[#6B4226]/80 active:scale-95 transition-all" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </main>
      </div>

      {/* 2. Sticky bottom bar with Section Name + Sync State indicator */}
      <footer className="sticky bottom-0 z-30 w-full border-t border-[#6B4226]/15 bg-[#FDFBF7]/95 backdrop-blur-md shadow-lg">
        <div className="w-full max-w-[640px] mx-auto px-5 py-3">
          <div className="flex items-center justify-between text-[13px] font-medium text-[#1F2A24] font-work-sans mb-1.5">
            <span>
              <strong className="text-[14px] text-[#1F2A24]">{presentCount}</strong> of{' '}
              <span className="text-[#1F2A24]/75">{totalCount}</span> present in {currentSectionLabel}
            </span>
            <span className="text-[#A8763E] font-semibold">{percent}%</span>
          </div>

          {/* Progress bar */}
          <div
            className="w-full h-2 bg-[#1F2A24]/10 rounded-full overflow-hidden mb-2.5"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Attendance progress"
          >
            <div
              className="h-full bg-[#A8763E] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Sync Status (Section Name + Sync State) & Summary Modal Button */}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            {/* Small status indicator: section name + sync state */}
            <div className="flex items-center gap-2 select-none min-h-[28px]">
              {hasPersistentSyncError && pendingSyncCount > 0 ? (
                <span
                  id="sync-status-badge"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#C94F3D] bg-[#C94F3D]/10 px-2.5 py-1 rounded-full border border-[#C94F3D]/25"
                >
                  <span className="w-2 h-2 rounded-full bg-[#C94F3D] animate-ping" />
                  <span>
                    {currentSectionLabel} • {pendingSyncCount} retry failed
                  </span>
                </span>
              ) : pendingSyncCount > 0 ? (
                /* Pulsing amber indicator with current section name */
                <span
                  id="sync-status-badge"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#A8763E] bg-[#A8763E]/12 px-2.5 py-1 rounded-full border border-[#A8763E]/25 transition-all"
                >
                  {isSyncing ? (
                    <>
                      <svg
                        className="animate-spin h-3.5 w-3.5 text-[#A8763E]"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                        />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>
                        {currentSectionLabel} • Syncing {pendingSyncCount}…
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-[#A8763E] animate-pulse" />
                      <span>
                        {currentSectionLabel} • {pendingSyncCount} pending
                      </span>
                    </>
                  )}
                </span>
              ) : (
                /* Steady green indicator with current section name */
                <span
                  id="sync-status-badge"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4C6B52]"
                >
                  <span className="w-2 h-2 rounded-full bg-[#4C6B52]" />
                  <span>{currentSectionLabel} • Synced</span>
                </span>
              )}

              {!isOnline && (
                <span
                  id="offline-pill"
                  className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#1F2A24]/8 text-[#1F2A24]/65"
                >
                  Offline
                </span>
              )}
            </div>

            <button
              id="session-summary-button"
              type="button"
              onClick={() => setShowSummaryModal(true)}
              className="px-3 py-1.5 rounded-[8px] bg-[#6B4226]/10 hover:bg-[#6B4226]/15 text-[#1F2A24] border border-[#6B4226]/20 text-[13px] font-medium font-work-sans transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>Summary</span>
            </button>
          </div>
        </div>
      </footer>

      {/* 3. New Person Intake Modal */}
      {isVisitorModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="visitor-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F2A24]/40 backdrop-blur-xs"
        >
          <div className="w-full max-w-[460px] bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] shadow-2xl p-6 flex flex-col space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2
                  id="visitor-modal-title"
                  className="font-fraunces text-[20px] font-bold text-[#1F2A24]"
                >
                  New Person Intake
                </h2>
                <div className="mt-1 text-[11px] text-[#1F2A24]/65 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4C6B52]" />
                  <span>
                    Collected by <strong>{userName}</strong> · {assignedSection}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsVisitorModalOpen(false)}
                className="text-[#1F2A24]/40 hover:text-[#1F2A24] p-1 cursor-pointer"
                aria-label="Close dialog"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="text-[13px] text-[#1F2A24]/70 font-work-sans">
              Enter attendee details. Submissions feed into the Head Usher approval queue for review
              before appearing on the active church roster.
            </p>

            {visitorSuccessMsg && (
              <div className="p-3 rounded-[10px] bg-[#4C6B52]/15 text-[#4C6B52] text-[13px] font-medium flex items-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{visitorSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateVisitor} className="space-y-3.5">
              <div>
                <label
                  htmlFor="visitor-fullname"
                  className="block text-[13px] font-semibold text-[#1F2A24]/85 mb-1"
                >
                  Full Name <span className="text-[#C94F3D]">*</span>
                </label>
                <input
                  id="visitor-fullname"
                  type="text"
                  required
                  value={visitorFullName}
                  onChange={(e) => setVisitorFullName(e.target.value)}
                  placeholder="e.g. Samuel Adebayo"
                  className="w-full px-3 py-2 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border border-[#6B4226]/25 rounded-[8px] outline-none focus:border-[#A8763E] focus:ring-1 focus:ring-[#A8763E]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="visitor-phone"
                    className="block text-[13px] font-semibold text-[#1F2A24]/85"
                  >
                    Phone Number <span className="text-[#C94F3D]">*</span>
                  </label>
                  {checkingVisitorPhone && (
                    <span className="text-[11px] text-[#A8763E] flex items-center gap-1 font-medium">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Checking…</span>
                    </span>
                  )}
                </div>

                <input
                  id="visitor-phone"
                  type="tel"
                  required
                  value={visitorPhone}
                  onChange={(e) => handleVisitorPhoneChange(e.target.value)}
                  placeholder="e.g. 08012345678"
                  className={`w-full px-3 py-2 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border rounded-[8px] outline-none ${
                    visitorMatchedDuplicate
                      ? 'border-[#A8763E] focus:ring-1 focus:ring-[#A8763E]'
                      : 'border-[#6B4226]/25 focus:border-[#A8763E] focus:ring-1 focus:ring-[#A8763E]'
                  }`}
                />

                {/* Non-blocking soft duplicate warning */}
                {visitorMatchedDuplicate && (
                  <div
                    role="status"
                    className="mt-2 p-2.5 rounded-[8px] bg-[#A8763E]/12 border border-[#A8763E]/30 text-[#1F2A24] text-[12px] leading-relaxed flex items-start gap-2"
                  >
                    <span className="text-[#A8763E] font-bold text-[13px] mt-0.5">⚠️</span>
                    <div className="flex-1">
                      <p>
                        <strong className="text-[#A8763E]">{visitorMatchedDuplicate.full_name}</strong>{' '}
                        is already on record with this number ({visitorMatchedDuplicate.unit_name} ·{' '}
                        {visitorMatchedDuplicate.section}).
                      </p>
                      <p className="text-[#1F2A24]/75 mt-0.5">
                        Submitting anyway will flag both for the head usher to merge or confirm as separate people.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="visitor-section-select"
                  className="block text-[13px] font-semibold text-[#1F2A24]/85 mb-1"
                >
                  Seating Section <span className="text-[#C94F3D]">*</span>
                </label>
                <select
                  id="visitor-section-select"
                  value={visitorSection}
                  onChange={(e) => setVisitorSection(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border border-[#6B4226]/25 rounded-[8px] outline-none focus:border-[#A8763E] cursor-pointer"
                >
                  {ALL_SECTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="visitor-unit-select"
                  className="block text-[13px] font-semibold text-[#1F2A24]/85 mb-1"
                >
                  Ministry Role / Unit <span className="text-[#C94F3D]">*</span>
                </label>
                <select
                  id="visitor-unit-select"
                  value={visitorUnit}
                  onChange={(e) => setVisitorUnit(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F7F3EC] text-[#1F2A24] text-[14px] border border-[#6B4226]/25 rounded-[8px] outline-none focus:border-[#A8763E] cursor-pointer"
                >
                  {ALL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-[13px] font-semibold text-[#1F2A24]/85 mb-1">
                  Attendee Status Flag <span className="text-[#C94F3D]">*</span>
                </span>
                <div className="grid grid-cols-2 gap-2 bg-[#F7F3EC] p-1 rounded-[10px] border border-[#6B4226]/20">
                  <button
                    type="button"
                    onClick={() => setVisitorStatusFlag('first_time')}
                    className={`py-1.5 px-2 text-[12px] font-medium rounded-[7px] transition-all cursor-pointer ${
                      visitorStatusFlag === 'first_time'
                        ? 'bg-[#A8763E] text-[#FDFBF7] font-semibold shadow-2xs'
                        : 'text-[#1F2A24]/75 hover:text-[#1F2A24]'
                    }`}
                  >
                    First-time visitor
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisitorStatusFlag('returning')}
                    className={`py-1.5 px-2 text-[12px] font-medium rounded-[7px] transition-all cursor-pointer ${
                      visitorStatusFlag === 'returning'
                        ? 'bg-[#4C6B52] text-[#FDFBF7] font-semibold shadow-2xs'
                        : 'text-[#1F2A24]/75 hover:text-[#1F2A24]'
                    }`}
                  >
                    Returning / known
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsVisitorModalOpen(false)}
                  disabled={savingVisitor}
                  className="px-4 py-2 rounded-[8px] border border-[#6B4226]/25 text-[#1F2A24]/75 text-[13px] hover:bg-[#1F2A24]/5 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-visitor-button"
                  type="submit"
                  disabled={savingVisitor || !visitorFullName.trim() || !visitorPhone.trim()}
                  className="px-4 py-2 rounded-[8px] bg-[#A8763E] hover:bg-[#976835] active:bg-[#855b2e] text-[#F7F3EC] text-[13px] font-medium cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {savingVisitor ? 'Submitting…' : 'Submit to Approval Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Session Summary Modal */}
      {showSummaryModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="summary-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F2A24]/40 backdrop-blur-xs"
        >
          <div className="w-full max-w-[460px] bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] shadow-2xl p-6 flex flex-col space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2
                id="summary-modal-title"
                className="font-fraunces text-[20px] font-bold text-[#1F2A24]"
              >
                Session Attendance Summary
              </h2>
              <button
                type="button"
                onClick={() => setShowSummaryModal(false)}
                className="text-[#1F2A24]/40 hover:text-[#1F2A24] p-1 cursor-pointer"
                aria-label="Close dialog"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="text-[13px] text-[#1F2A24]/75 font-work-sans leading-relaxed">
              Overview for <strong>{service ? service.type : 'Sunday Service'}</strong>. Taps write
              locally to the device first and synchronize idempotently.
            </p>

            {/* Room by Room Breakdown */}
            <div className="bg-[#F7F3EC] border border-[#6B4226]/15 rounded-[12px] p-4 space-y-3 text-[13px] font-work-sans">
              <div className="font-semibold text-[#1F2A24] border-b border-[#6B4226]/10 pb-1.5 flex items-center justify-between">
                <span>Room / Physical Section</span>
                <span>Present / Total</span>
              </div>

              {ALL_SECTIONS.map((sec) => {
                const st = roomStats[sec] || { total: 0, present: 0 }
                const pct = st.total > 0 ? Math.round((st.present / st.total) * 100) : 0
                return (
                  <div key={sec} className="flex items-center justify-between">
                    <span className="text-[#1F2A24]/80">{sec}</span>
                    <span className="font-medium text-[#1F2A24]">
                      <strong className="text-[#4C6B52]">{st.present}</strong> / {st.total}{' '}
                      <span className="text-[#1F2A24]/50 text-[11px]">({pct}%)</span>
                    </span>
                  </div>
                )
              })}

              <div className="pt-2 border-t border-[#6B4226]/15 flex items-center justify-between font-bold text-[14px]">
                <span className="text-[#1F2A24]">Church-wide Total</span>
                <span className="text-[#A8763E]">
                  {roomStats.total?.present || presentCount} / {roomStats.total?.total || totalCount}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-[8px] bg-[#4C6B52]/10 border border-[#4C6B52]/20 text-[#4C6B52] text-[12px] font-work-sans flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#4C6B52] shrink-0" />
              <span>
                Each section is maintained independently by its assigned usher without collision.
              </span>
            </div>

            <div className="pt-1">
              <button
                id="close-summary-modal-button"
                type="button"
                onClick={() => setShowSummaryModal(false)}
                className="w-full py-2.5 px-4 rounded-[10px] bg-[#A8763E] text-[#F7F3EC] text-[14px] font-medium font-work-sans hover:bg-[#976835] active:bg-[#855b2e] cursor-pointer transition-colors shadow-xs"
              >
                Close Summary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
