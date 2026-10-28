import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const ALL_SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const
type SectionName = (typeof ALL_SECTIONS)[number]

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const serviceId = body?.serviceId
    const query = (body?.query ?? '').trim().toLowerCase()
    const targetSection = (body?.section ?? '').trim()

    if (!serviceId) {
      return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })
    }

    // 1. Fetch people: attempt to select section and positions column if present
    let peopleData: any[] | null = null
    const { data: withSectionAndPositions, error: sectionErr } = await supabaseAdmin
      .from('people')
      .select('id, full_name, phone, unit_id, units(name), section, positions')
      .eq('status', 'active')
      .order('full_name', { ascending: true })

    if (!sectionErr && withSectionAndPositions) {
      peopleData = withSectionAndPositions
    } else {
      const { data: fallbackPeople, error: fallbackErr } = await supabaseAdmin
        .from('people')
        .select('id, full_name, phone, unit_id, units(name), section')
        .eq('status', 'active')
        .order('full_name', { ascending: true })

      if (!fallbackErr && fallbackPeople) {
        peopleData = fallbackPeople
      } else {
        const { data: withoutSection, error: baseErr } = await supabaseAdmin
          .from('people')
          .select('id, full_name, phone, unit_id, units(name)')
          .eq('status', 'active')
          .order('full_name', { ascending: true })

        if (baseErr) {
          console.error('Error fetching people:', baseErr)
          return NextResponse.json({ error: 'Failed to search members' }, { status: 500 })
        }
        peopleData = withoutSection
      }
    }

    // 2. Fetch attendance for this service
    const { data: attendanceData } = await supabaseAdmin
      .from('attendance')
      .select('person_id')
      .eq('service_id', serviceId)

    const presentPersonIds = new Set(attendanceData?.map((a) => a.person_id) ?? [])

    // 3. Map members with proper unit, section, and positions defaults
    const allMapped = (peopleData ?? []).map((p: any, idx: number) => {
      const rawUnit = p.units?.name
      const unitName = rawUnit || 'Member'

      let section: SectionName = 'Adults & Youth'
      if (p.section && ALL_SECTIONS.includes(p.section)) {
        section = p.section
      } else if (unitName === 'Youth') {
        section = 'Teenagers'
      } else if (unitName === 'Children') {
        section = idx % 2 === 0 ? 'Older Children' : 'Infants'
      } else {
        section = 'Adults & Youth'
      }

      const positions: string[] = Array.isArray(p.positions) ? p.positions : []

      return {
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        unit_name: unitName,
        section,
        positions,
        is_present: presentPersonIds.has(p.id),
      }
    })

    // 4. Compute live running totals across all 4 rooms
    const stats: Record<string, { total: number; present: number }> = {
      'Adults & Youth': { total: 0, present: 0 },
      'Infants': { total: 0, present: 0 },
      'Older Children': { total: 0, present: 0 },
      'Teenagers': { total: 0, present: 0 },
      total: { total: allMapped.length, present: 0 },
    }

    for (const person of allMapped) {
      const sec = person.section as SectionName
      if (stats[sec]) {
        stats[sec].total += 1
        if (person.is_present) {
          stats[sec].present += 1
          stats.total.present += 1
        }
      }
    }

    // 5. Filter by section if scoped (attendance_staff assigned_section or admin filter)
    let filteredPeople = allMapped
    if (targetSection && targetSection !== 'all' && targetSection !== 'All Sections') {
      filteredPeople = allMapped.filter((p) => p.section === targetSection)
    }

    // 6. Filter by search query if provided (matches name, phone, unit, or positions)
    if (query) {
      filteredPeople = filteredPeople.filter((p) => {
        const nameMatch = p.full_name.toLowerCase().includes(query)
        const phoneMatch = p.phone ? p.phone.toLowerCase().includes(query) : false
        const unitMatch = (p.unit_name ?? '').toLowerCase().includes(query)
        const positionsMatch = Array.isArray(p.positions) && p.positions.some((pos: string) => pos.toLowerCase().includes(query))
        return nameMatch || phoneMatch || unitMatch || positionsMatch
      })
    }

    // Strip out raw phone numbers so clients never receive plain phone numbers
    const sanitizedPeople = filteredPeople.map(({ phone, ...rest }) => rest)

    return NextResponse.json({
      people: sanitizedPeople,
      stats,
    })
  } catch (err) {
    console.error('Error in attendance search API:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
