import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

const ALLOWED_STAFF_ROLES = ['attendance_staff', 'attendance_admin', 'usher', 'head_usher'] as const
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
    // 1. Authenticate caller: Bearer token
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    let callerId: string | null = null
    let callerEmail: string | null = null
    let callerRole: string | null = null

    if (token) {
      const { data: authData } = await supabaseAdmin.auth.getUser(token)
      if (authData?.user) {
        callerId = authData.user.id
        callerEmail = authData.user.email?.toLowerCase() || null

        const { data: sr } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('user_id', callerId)
          .maybeSingle()
        if (sr?.role) callerRole = sr.role

        try {
          const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
          if (fs.existsSync(devFile)) {
            const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
            const devEntry = devMap[callerId] || (callerEmail && devMap[callerEmail])
            if (devEntry?.role) callerRole = devEntry.role
          }
        } catch (_) {}
      }
    }

    const devRoleHeader = request.headers.get('x-dev-role')
    if (devRoleHeader && process.env.NODE_ENV !== 'production') {
      callerRole = devRoleHeader
    }

    // STRICT PERMISSION CHECK: Only 'super_admin' is permitted.
    const ALLOWED_STAFF_APPROVAL_ROLES = ['super_admin']
    if (!callerRole || !ALLOWED_STAFF_APPROVAL_ROLES.includes(callerRole)) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only Super Admin can approve or reject staff account requests.',
          callerRole: callerRole || 'unauthenticated',
        },
        { status: 403 }
      )
    }

    // 2. Parse request body
    const body = await request.json().catch(() => null)
    const {
      requestId,
      action, // 'approve' | 'reject'
      approvedRole, // 'usher' | 'head_usher'
      approvedSection,
      rejectionReason,
    } = body || {}

    if (!requestId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Valid requestId and action (approve | reject) are required.' },
        { status: 400 }
      )
    }

    // 3. Find the pending request (DB first, fallback second)
    let staffReq: any = null
    try {
      const { data } = await supabaseAdmin
        .from('pending_staff_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle()
      if (data) staffReq = data
    } catch (_) {}

    if (!staffReq) {
      const fallbackList = readFallbackRequests()
      staffReq = fallbackList.find((r) => r.id === requestId)
    }

    if (!staffReq) {
      return NextResponse.json({ error: 'Staff request not found.' }, { status: 404 })
    }

    if (staffReq.status !== 'pending') {
      return NextResponse.json(
        { error: `This staff request has already been ${staffReq.status}.` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // 4. Handle REJECT
    if (action === 'reject') {
      // Update in DB
      try {
        await supabaseAdmin
          .from('pending_staff_requests')
          .update({
            status: 'rejected',
            rejection_reason: rejectionReason || null,
            reviewed_by: callerId,
            reviewed_at: now,
            updated_at: now,
          })
          .eq('id', requestId)
      } catch (_) {}

      // Update in fallback file
      const fallbackList = readFallbackRequests()
      const fbIndex = fallbackList.findIndex((r) => r.id === requestId)
      if (fbIndex !== -1) {
        fallbackList[fbIndex].status = 'rejected'
        fallbackList[fbIndex].rejection_reason = rejectionReason || null
        fallbackList[fbIndex].reviewed_by = callerId
        fallbackList[fbIndex].reviewed_at = now
        fallbackList[fbIndex].updated_at = now
        writeFallbackRequests(fallbackList)
      }

      return NextResponse.json({
        success: true,
        message: 'Staff request has been rejected.',
        requestId,
        status: 'rejected',
      })
    }

    // 5. Handle APPROVE
    // SERVER-SIDE ROLE CONSTRAINT: MUST reject any attempt to set role to super_admin or invalid roles
    let finalRole = (approvedRole || staffReq.requested_role || 'attendance_staff').trim().toLowerCase()
    if (finalRole === 'usher') finalRole = 'attendance_staff'
    if (finalRole === 'head_usher') finalRole = 'attendance_admin'
    if (!['attendance_staff', 'attendance_admin'].includes(finalRole)) {
      return NextResponse.json(
        {
          error:
            'Security violation: Staff requests can only be approved as Attendance Staff or Attendance Admin. Super Admin roles must be configured directly by system administration.',
        },
        { status: 400 }
      )
    }

    const finalSection = (approvedSection || staffReq.requested_section || 'Adults & Youth').trim()
    if (!ALLOWED_SECTIONS.includes(finalSection as any)) {
      return NextResponse.json(
        {
          error:
            'Invalid section. Must be one of: Adults & Youth, Infants, Older Children, Teenagers.',
        },
        { status: 400 }
      )
    }

    const userEmail = staffReq.email.trim().toLowerCase()
    const fullName = staffReq.full_name.trim()
    const phone = staffReq.phone.trim()

    // A. Upsert Person record in people table
    let personId: string | null = null
    try {
      const { data: existingPerson } = await supabaseAdmin
        .from('people')
        .select('id')
        .ilike('email', userEmail)
        .maybeSingle()

      let { data: unitRecord } = await supabaseAdmin
        .from('units')
        .select('id')
        .ilike('name', 'Ushers')
        .maybeSingle()

      if (!unitRecord) {
        const { data: defUnit } = await supabaseAdmin
          .from('units')
          .select('id')
          .ilike('name', 'Member')
          .maybeSingle()
        unitRecord = defUnit
      }

      if (existingPerson) {
        personId = existingPerson.id
        await supabaseAdmin
          .from('people')
          .update({
            full_name: fullName,
            phone,
            section: finalSection,
            unit_id: unitRecord?.id || null,
            status: 'active',
          })
          .eq('id', personId)
      } else {
        const { data: newPerson, error: insertPErr } = await supabaseAdmin
          .from('people')
          .insert({
            full_name: fullName,
            email: userEmail,
            phone,
            section: finalSection,
            unit_id: unitRecord?.id || null,
            status: 'active',
          })
          .select('id')
          .single()
        if (newPerson) personId = newPerson.id
        if (insertPErr) console.error('Error inserting person in people table:', insertPErr)
      }
    } catch (err) {
      console.error('Error upserting person in people table:', err)
    }

    // B. Ensure Supabase Auth user exists
    let authUserId: string | null = null
    try {
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers()
      const foundAuth = userList?.users?.find((u) => u.email?.toLowerCase() === userEmail)

      if (foundAuth) {
        authUserId = foundAuth.id
      } else {
        // Create new auth user
        const { data: createdAuth, error: createAuthErr } =
          await supabaseAdmin.auth.admin.createUser({
            email: userEmail,
            email_confirm: true,
            user_metadata: {
              full_name: fullName,
              assigned_section: finalSection,
              role: finalRole,
            },
          })
        if (!createAuthErr && createdAuth?.user) {
          authUserId = createdAuth.user.id
        }
      }
    } catch (err) {
      console.error('Error finding or creating auth user:', err)
    }

    // C. Upsert role in staff_roles
    if (authUserId) {
      try {
        await supabaseAdmin.from('staff_roles').upsert({
          user_id: authUserId,
          role: finalRole,
          assigned_section: finalSection,
          ...(personId ? { person_id: personId } : {}),
        })
      } catch (err) {
        console.error('Error upserting staff_roles:', err)
      }
    }

    // D. Resilient fallback storage: Update dev_roles.json
    try {
      const devDir = path.join(process.cwd(), '.temp_data')
      if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true })
      const devFile = path.join(devDir, 'dev_roles.json')
      let devMap: any = {}
      if (fs.existsSync(devFile)) {
        try {
          devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        } catch {}
      }
      devMap[userEmail] = {
        role: finalRole,
        section: finalSection,
        name: fullName,
        phone,
      }
      if (authUserId) {
        devMap[authUserId] = {
          role: finalRole,
          section: finalSection,
          name: fullName,
          phone,
        }
      }
      fs.writeFileSync(devFile, JSON.stringify(devMap, null, 2))
    } catch (err) {
      console.error('Error writing dev_roles.json:', err)
    }

    // E. Trigger email-OTP invite / activation
    let activationTriggered = false
    try {
      // Trigger Supabase OTP sign-in / invite so user receives code / activation link
      const { error: otpErr } = await supabaseAdmin.auth.signInWithOtp({
        email: userEmail,
        options: {
          shouldCreateUser: false,
        },
      })
      if (!otpErr) {
        activationTriggered = true
      }
    } catch (_) {}

    // F. Mark request as approved in DB
    try {
      await supabaseAdmin
        .from('pending_staff_requests')
        .update({
          status: 'approved',
          requested_role: finalRole,
          requested_section: finalSection,
          reviewed_by: callerId,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('id', requestId)
    } catch (_) {}

    // G. Mark request as approved in fallback queue
    const fallbackList = readFallbackRequests()
    const fbIndex = fallbackList.findIndex((r) => r.id === requestId)
    if (fbIndex !== -1) {
      fallbackList[fbIndex].status = 'approved'
      fallbackList[fbIndex].requested_role = finalRole
      fallbackList[fbIndex].requested_section = finalSection
      fallbackList[fbIndex].reviewed_by = callerId
      fallbackList[fbIndex].reviewed_at = now
      fallbackList[fbIndex].updated_at = now
      writeFallbackRequests(fallbackList)
    }

    return NextResponse.json({
      success: true,
      message: `Staff account successfully approved and activated as ${finalRole === 'attendance_admin' ? 'Attendance Admin' : 'Attendance Staff'} for ${finalSection}.`,
      requestId,
      status: 'approved',
      approvedRole: finalRole,
      approvedSection: finalSection,
      email: userEmail,
      activationTriggered,
    })
  } catch (err: any) {
    console.error('Error in POST /api/staff-requests/action:', err)
    return NextResponse.json(
      { error: 'Failed to process staff request action', details: err?.message },
      { status: 500 }
    )
  }
}
