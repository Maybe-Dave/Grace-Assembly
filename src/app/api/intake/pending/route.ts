import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

const FALLBACK_DIR = path.join(process.cwd(), '.temp_data')
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'pending_people.json')

function readFallbackQueue(): any[] {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return []
    const content = fs.readFileSync(FALLBACK_FILE, 'utf-8')
    return JSON.parse(content) || []
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  try {
    // 1. Authenticate caller: head_usher only
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: authentication required' },
        { status: 401 }
      )
    }

    let callerRole = ''
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or expired session' },
        { status: 401 }
      )
    }

    const { data: sr } = await supabaseAdmin
      .from('staff_roles')
      .select('role')
      .eq('user_id', authData.user.id)
      .maybeSingle()
    if (sr?.role) callerRole = sr.role

    // Dev override check for local testing
    try {
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry =
          devMap[authData.user.id] ||
          (authData.user.email && devMap[authData.user.email.toLowerCase()])
        if (devEntry?.role) callerRole = devEntry.role
      }
    } catch (_) {}

    // Role check: super_admin and attendance_admin are permitted
    const ALLOWED_INTAKE_ROLES = ['super_admin', 'attendance_admin']
    if (!callerRole || !ALLOWED_INTAKE_ROLES.includes(callerRole)) {
      return NextResponse.json(
        { error: 'Forbidden: super_admin or attendance_admin role required to view the approval queue.' },
        { status: 403 }
      )
    }

    // 2. Fetch pending submissions from database
    let pendingList: any[] = []
    let dbSuccess = false

    try {
      const { data, error } = await supabaseAdmin
        .from('pending_people')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        pendingList = data
        dbSuccess = true
      }
    } catch (_) {}

    // Fallback to local queue if database table is not yet created
    if (!dbSuccess) {
      const fallbackItems = readFallbackQueue()
      pendingList = fallbackItems.filter((item) => item.status === 'pending')
    }

    // 3. For any item with duplicate_matched_person_id, fetch existing record for side-by-side review
    const duplicateIds = Array.from(
      new Set(pendingList.map((item) => item.duplicate_matched_person_id).filter(Boolean))
    )

    let matchedPeopleMap = new Map<string, any>()
    if (duplicateIds.length > 0) {
      const { data: matchedRecords } = await supabaseAdmin
        .from('people')
        .select('id, full_name, phone, section, unit_id, units(name)')
        .in('id', duplicateIds)

      if (matchedRecords) {
        for (const p of matchedRecords) {
          matchedPeopleMap.set(p.id, {
            id: p.id,
            full_name: p.full_name,
            phone: p.phone,
            unit_name: (p as any).units?.name || 'Member',
            section: (p as any).section || 'Adults & Youth',
          })
        }
      }
    }

    const enrichedList = pendingList.map((item) => ({
      ...item,
      matched_person: item.duplicate_matched_person_id
        ? matchedPeopleMap.get(item.duplicate_matched_person_id) || null
        : null,
    }))

    return NextResponse.json({
      pendingPeople: enrichedList,
      count: enrichedList.length,
    })
  } catch (err: any) {
    console.error('Error in /api/intake/pending:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
