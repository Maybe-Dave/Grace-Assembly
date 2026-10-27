import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

const ALLOWED_ROLES = ['usher', 'head_usher'] as const
const ALLOWED_SECTIONS = ['Adults & Youth', 'Infants', 'Older Children', 'Teenagers'] as const

const FALLBACK_DIR = path.join(process.cwd(), '.temp_data')
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'pending_staff_requests.json')

function readFallbackRequests(): any[] {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return []
    return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8')) || []
  } catch {
    return []
  }
}

function writeFallbackRequests(items: any[]) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true })
    }
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(items, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write fallback staff requests:', err)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const fullName = (body?.fullName ?? '').trim()
    const rawEmail = (body?.email ?? '').trim().toLowerCase()
    const phone = (body?.phone ?? '').trim()
    const requestedRole = (body?.requestedRole ?? '').trim().toLowerCase()
    const requestedSection = (body?.requestedSection ?? '').trim()

    // 1. Validate fields
    if (!fullName) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!rawEmail || !emailRegex.test(rawEmail)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 })
    }

    // Strictly enforce role: ONLY usher or head_usher allowed (do NOT allow self-selecting admin, pastor, or secretary)
    if (!ALLOWED_ROLES.includes(requestedRole as any)) {
      return NextResponse.json(
        { error: 'Invalid requested role. Only Usher or Head Usher can be requested.' },
        { status: 400 }
      )
    }

    if (!ALLOWED_SECTIONS.includes(requestedSection as any)) {
      return NextResponse.json(
        { error: 'Please select a valid seating section (Adults & Youth, Infants, Older Children, or Teenagers).' },
        { status: 400 }
      )
    }

    // 2. Explicit Edge Case: Reject if email already has an approved staff account
    try {
      let isApprovedStaff = false

      // Check in people table
      const { data: existingPerson } = await supabaseAdmin
        .from('people')
        .select('id, full_name, email')
        .ilike('email', rawEmail)
        .maybeSingle()

      if (existingPerson) {
        const { data: userList } = await supabaseAdmin.auth.admin.listUsers()
        const authUser = userList?.users?.find((u) => u.email?.toLowerCase() === rawEmail)

        if (authUser) {
          const { data: sr } = await supabaseAdmin
            .from('staff_roles')
            .select('role')
            .eq('user_id', authUser.id)
            .maybeSingle()
          if (sr?.role) isApprovedStaff = true
        }
      }

      // Also check dev roles fallback
      try {
        const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
        if (fs.existsSync(devFile)) {
          const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
          if (devMap[rawEmail]?.role) isApprovedStaff = true
        }
      } catch (_) {}

      if (isApprovedStaff) {
        return NextResponse.json(
          { error: 'This email already has an active staff account. Please sign in directly.' },
          { status: 409 }
        )
      }
    } catch (_) {}

    // 3. Reject duplicate pending request for the same email
    try {
      const { data: existingPending } = await supabaseAdmin
        .from('pending_staff_requests')
        .select('id, status')
        .ilike('email', rawEmail)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingPending) {
        return NextResponse.json(
          { error: 'A staff access request for this email is already pending review by church leadership.' },
          { status: 409 }
        )
      }
    } catch (_) {}

    // Check fallback requests file as well
    const fallbackList = readFallbackRequests()
    const duplicateFallback = fallbackList.find(
      (r) => r.email?.toLowerCase() === rawEmail && r.status === 'pending'
    )
    if (duplicateFallback) {
      return NextResponse.json(
        { error: 'A staff access request for this email is already pending review by church leadership.' },
        { status: 409 }
      )
    }

    // 4. Create new pending staff request
    const newRequest = {
      id: crypto.randomUUID(),
      full_name: fullName,
      email: rawEmail,
      phone,
      requested_role: requestedRole,
      requested_section: requestedSection,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    let dbSuccess = false
    try {
      const { data, error } = await supabaseAdmin
        .from('pending_staff_requests')
        .insert(newRequest)
        .select()
        .single()

      if (!error && data) {
        dbSuccess = true
        return NextResponse.json({
          success: true,
          requestId: data.id,
          request: data,
          storage: 'database',
        })
      }
    } catch (_) {}

    if (!dbSuccess) {
      fallbackList.unshift(newRequest)
      writeFallbackRequests(fallbackList)
      return NextResponse.json({
        success: true,
        requestId: newRequest.id,
        request: newRequest,
        storage: 'fallback_queue',
      })
    }
  } catch (err: any) {
    console.error('Error in /api/staff-requests/submit:', err)
    return NextResponse.json(
      { error: 'Failed to submit staff access request', details: err?.message },
      { status: 500 }
    )
  }
}
