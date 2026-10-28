import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')

    let userEmail: string | null = null
    let userId: string | null = null

    if (token) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
      if (!authErr && authData?.user) {
        userEmail = authData.user.email ?? null
        userId = authData.user.id
      }
    }

    if (!userEmail) {
      const body = await request.json().catch(() => null)
      if (body?.email) userEmail = String(body.email).trim().toLowerCase()
      if (body?.userId) userId = String(body.userId)
    }

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = userEmail.toLowerCase().trim()

    // 1. Look up person record
    const { data: person } = await supabaseAdmin
      .from('people')
      .select('id, full_name, email, positions')
      .ilike('email', email)
      .maybeSingle()

    // 2. Look up staff role & assigned_section
    let role: string | null = null
    let assignedSection: string = 'Adults & Youth'

    if (userId) {
      // First attempt with assigned_section
      const { data: sr, error: srErr } = await supabaseAdmin
        .from('staff_roles')
        .select('role, assigned_section')
        .eq('user_id', userId)
        .maybeSingle()

      if (!srErr && sr) {
        role = sr.role ?? null
        if (sr.assigned_section) assignedSection = sr.assigned_section
      } else {
        // Fallback if column doesn't exist yet
        const { data: srFallback } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle()
        if (srFallback) role = srFallback.role ?? null
      }
    }

    // Try finding role by person_id if still null
    if (person && role === null) {
      try {
        const { data: srPerson } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('person_id', person.id)
          .maybeSingle()
        if (srPerson) {
          role = srPerson.role ?? null
        }
      } catch {
        // Ignored if column doesn't exist
      }
    }

    // Dev override fallback
    try {
      const fs = await import('fs')
      const path = await import('path')
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const rolesMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry = (userId && rolesMap[userId]) || (email && rolesMap[email])
        if (devEntry && devEntry.role !== undefined) role = devEntry.role
        if (devEntry?.section) assignedSection = devEntry.section
      }
    } catch (_) {}

    return NextResponse.json({
      email,
      role,
      name: person?.full_name ?? email,
      assigned_section: assignedSection,
      positions: Array.isArray(person?.positions) ? person.positions : [],
    })
  } catch (err) {
    console.error('Error in /api/auth/me:', err)
    return NextResponse.json({ error: 'Failed to retrieve profile' }, { status: 500 })
  }
}
