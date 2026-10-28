import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

const ALL_SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const
type SectionName = (typeof ALL_SECTIONS)[number]

export async function GET(request: Request) {
  try {
    // 1. Authenticate caller: Bearer token (REQUIRED — no token = 401, not 200)
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: authentication required' },
        { status: 401 }
      )
    }

    let callerId = ''
    let callerRole = ''
    let callerEmail = ''

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or expired session' },
        { status: 401 }
      )
    }

    callerId = authData.user.id
    callerEmail = authData.user.email || ''

    const { data: sr } = await supabaseAdmin
      .from('staff_roles')
      .select('role')
      .eq('user_id', callerId)
      .maybeSingle()
    if (sr?.role) callerRole = sr.role

    // Dev override check
    try {
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry = devMap[callerId] || (callerEmail && devMap[callerEmail.toLowerCase()])
        if (devEntry?.role) callerRole = devEntry.role
      }
    } catch (_) {}

    // Role gate: Only super_admin or attendance_admin can view dashboard.
    // attendance_staff, finance_*, events_*, and NULL roles MUST receive 403 Forbidden.
    const ALLOWED_DASHBOARD_ROLES = ['super_admin', 'attendance_admin']
    if (!callerRole || !ALLOWED_DASHBOARD_ROLES.includes(callerRole)) {
      return NextResponse.json(
        {
          error:
            'Forbidden: super_admin or attendance_admin role required to access the combined attendance dashboard.',
          userRole: callerRole || 'unknown',
        },
        { status: 403 }
      )
    }

    // 2. Fetch all services (ordered by date descending)
    let servicesData: any[] = []
    const { data: dbServices, error: servicesErr } = await supabaseAdmin
      .from('services')
      .select('id, type, service_date, service_time, created_at, status')
      .order('service_date', { ascending: false })
      .order('service_time', { ascending: false })

    if (!servicesErr && dbServices) {
      servicesData = dbServices
    } else {
      const { data: fallbackServices } = await supabaseAdmin
        .from('services')
        .select('id, type, service_date, service_time, created_at')
        .order('service_date', { ascending: false })
        .order('service_time', { ascending: false })
      servicesData = fallbackServices || []
    }

    // Check for stored active service fallback if needed
    let storedActive: any = null
    try {
      const tempFile = path.join(process.cwd(), '.temp_data', 'active_service.json')
      if (fs.existsSync(tempFile)) {
        storedActive = JSON.parse(fs.readFileSync(tempFile, 'utf-8'))
      }
    } catch (_) {}

    if (servicesData.length === 0 && !storedActive) {
      return NextResponse.json({
        activeService: null,
        historicalServices: [],
      })
    }

    // Find active service (by status='active', then stored fallback, then most recent)
    let activeService = servicesData.find((s) => s.status === 'active') || null
    if (!activeService && storedActive) {
      activeService = storedActive
      if (!servicesData.some((s) => s.id === storedActive.id)) {
        servicesData.unshift(storedActive)
      }
    }
    if (!activeService && servicesData.length > 0) {
      activeService = servicesData[0]
    }

    // 3. Fetch active people with sections and unit info
    let peopleList: any[] = []
    const { data: pWithSection } = await supabaseAdmin
      .from('people')
      .select('id, full_name, section, unit_id, units(name)')
      .eq('status', 'active')

    if (pWithSection && pWithSection.length > 0) {
      peopleList = pWithSection
    } else {
      const { data: pFallback } = await supabaseAdmin
        .from('people')
        .select('id, full_name, unit_id, units(name)')
        .eq('status', 'active')
      peopleList = pFallback || []
    }

    // Map each person to a physical section
    const peopleMapped = peopleList.map((p, idx) => {
      let sec: SectionName = 'Adults & Youth'
      if (p.section && ALL_SECTIONS.includes(p.section)) {
        sec = p.section
      } else {
        const uName = p.units?.name
        if (uName === 'Youth') sec = 'Teenagers'
        else if (uName === 'Children') sec = 'Older Children'
        else sec = 'Adults & Youth'
      }
      return {
        id: p.id,
        full_name: p.full_name,
        section: sec,
      }
    })

    // Roster count per section
    const sectionTotals: Record<SectionName, number> = {
      'Adults & Youth': 0,
      'Infants': 0,
      'Older Children': 0,
      'Teenagers': 0,
    }
    for (const p of peopleMapped) {
      if (sectionTotals[p.section] !== undefined) {
        sectionTotals[p.section]++
      }
    }
    const combinedTotal = peopleMapped.length

    // 4. Fetch attendance records for the active service
    const { data: activeAttendance } = await supabaseAdmin
      .from('attendance')
      .select('id, person_id, marked_by, marked_at')
      .eq('service_id', activeService.id)

    const personIdToSection = new Map(peopleMapped.map((p) => [p.id, p.section]))

    // Build known staff mapping
    const staffNames: Record<string, string> = {
      '00000000-0000-0000-0000-000000000001': 'Admin Office',
    }
    try {
      const { data: staffPeople } = await supabaseAdmin
        .from('people')
        .select('id, full_name, email')
      for (const sp of staffPeople || []) {
        if (sp.email) staffNames[sp.email.toLowerCase()] = sp.full_name
      }
    } catch (_) {}

    // Group attendance marks per section and per usher
    const sectionPresent: Record<SectionName, Set<string>> = {
      'Adults & Youth': new Set(),
      'Infants': new Set(),
      'Older Children': new Set(),
      'Teenagers': new Set(),
    }

    // Usher marking tracking: section -> usherId -> count
    const sectionUshers: Record<SectionName, Map<string, number>> = {
      'Adults & Youth': new Map(),
      'Infants': new Map(),
      'Older Children': new Map(),
      'Teenagers': new Map(),
    }

    const allPresentSet = new Set<string>()

    for (const row of activeAttendance || []) {
      allPresentSet.add(row.person_id)
      const sec = personIdToSection.get(row.person_id) as SectionName | undefined
      if (sec && sectionPresent[sec]) {
        sectionPresent[sec].add(row.person_id)

        const usherKey = row.marked_by || 'unknown'
        const currentCount = sectionUshers[sec].get(usherKey) || 0
        sectionUshers[sec].set(usherKey, currentCount + 1)
      }
    }

    // Resolve usher details
    const uniqueUsherIds = Array.from(
      new Set(
        Object.values(sectionUshers).flatMap((map) => Array.from(map.keys()))
      )
    ).filter((id) => id !== 'unknown')

    const usherProfileMap = new Map<string, { name: string; section?: string }>()
    if (uniqueUsherIds.length > 0) {
      try {
        const { data: srData } = await supabaseAdmin
          .from('staff_roles')
          .select('user_id, assigned_section')
          .in('user_id', uniqueUsherIds)
        for (const sr of srData || []) {
          usherProfileMap.set(sr.user_id, {
            name: staffNames[sr.user_id] || 'Staff Usher',
            section: sr.assigned_section,
          })
        }
      } catch (_) {}
    }

    // Format section breakdowns
    const sectionBreakdowns = ALL_SECTIONS.map((sec) => {
      const total = sectionTotals[sec] || 0
      const present = sectionPresent[sec]?.size || 0
      const percent = total > 0 ? Math.round((present / total) * 100) : 0

      const ushersList = Array.from(sectionUshers[sec].entries()).map(
        ([usherId, marksCount]) => {
          const profile = usherProfileMap.get(usherId)
          const displayName =
            usherId === callerId
              ? `${callerEmail.split('@')[0]} (You)`
              : profile?.name || `Usher (${usherId.slice(0, 6)})`
          return {
            id: usherId,
            name: displayName,
            marksCount,
          }
        }
      )

      return {
        section: sec,
        present,
        total,
        percent,
        ushers: ushersList,
      }
    })

    const combinedPresent = allPresentSet.size
    const combinedPercent =
      combinedTotal > 0 ? Math.round((combinedPresent / combinedTotal) * 100) : 0

    // 5. Build Historical Services Trends
    // Gather attendance counts for other past services
    const pastServicesList = servicesData.slice(0, 8)
    const pastServiceIds = pastServicesList.map((s) => s.id)

    const { data: historicalAttendance } = await supabaseAdmin
      .from('attendance')
      .select('service_id, person_id')
      .in('service_id', pastServiceIds)

    const serviceAttendanceMap = new Map<string, Set<string>>()
    for (const s of pastServicesList) {
      serviceAttendanceMap.set(s.id, new Set())
    }
    for (const a of historicalAttendance || []) {
      const set = serviceAttendanceMap.get(a.service_id)
      if (set) set.add(a.person_id)
    }

    const historicalServices = pastServicesList.map((s) => {
      const attendees = serviceAttendanceMap.get(s.id) || new Set()
      const totalAttended = attendees.size
      const pct = combinedTotal > 0 ? Math.round((totalAttended / combinedTotal) * 100) : 0

      // Section breakdown for this historical service
      const bySec: Record<string, number> = {
        'Adults & Youth': 0,
        'Infants': 0,
        'Older Children': 0,
        'Teenagers': 0,
      }
      for (const pId of attendees) {
        const sec = personIdToSection.get(pId)
        if (sec && bySec[sec] !== undefined) {
          bySec[sec]++
        }
      }

      return {
        id: s.id,
        type: s.type,
        serviceDate: s.service_date,
        serviceTime: s.service_time,
        combinedPresent: totalAttended,
        combinedTotal,
        percent: pct,
        sections: ALL_SECTIONS.map((sec) => ({
          section: sec,
          present: bySec[sec] || 0,
          total: sectionTotals[sec] || 0,
        })),
      }
    })

    return NextResponse.json({
      success: true,
      userRole: callerRole,
      activeService: {
        id: activeService.id,
        type: activeService.type,
        serviceDate: activeService.service_date,
        serviceTime: activeService.service_time,
        combinedTotal,
        combinedPresent,
        combinedPercent,
        sections: sectionBreakdowns,
      },
      historicalServices,
      timestamp: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('Error in /api/dashboard/stats:', err)
    return NextResponse.json(
      { error: 'Failed to retrieve dashboard stats', details: err?.message },
      { status: 500 }
    )
  }
}
