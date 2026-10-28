import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    // 1. Authenticate caller strictly via Bearer token
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: missing authorization token' },
        { status: 401 }
      )
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or expired session' },
        { status: 401 }
      )
    }

    const verifiedUser = authData.user

    // 2. Authorize caller: verify active staff role (super_admin, attendance_admin, attendance_staff)
    let callerRole = ''
    let callerAssignedSection = ''
    const { data: roleRecord } = await supabaseAdmin
      .from('staff_roles')
      .select('role, assigned_section')
      .eq('user_id', verifiedUser.id)
      .maybeSingle()

    if (roleRecord?.role) {
      callerRole = roleRecord.role
    }
    if (roleRecord?.assigned_section) {
      callerAssignedSection = roleRecord.assigned_section
    }

    // Dev override fallback
    try {
      const fs = await import('fs')
      const path = await import('path')
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry =
          devMap[verifiedUser.id] ||
          (verifiedUser.email && devMap[verifiedUser.email.toLowerCase()])
        if (devEntry && devEntry.role !== undefined) callerRole = devEntry.role
        if (devEntry?.section) callerAssignedSection = devEntry.section
      }
    } catch (_) {}

    const ALLOWED_ROLES = ['super_admin', 'attendance_admin', 'attendance_staff']
    if (!callerRole || !ALLOWED_ROLES.includes(callerRole)) {
      return NextResponse.json(
        { error: 'Forbidden: attendance staff or admin role required' },
        { status: 403 }
      )
    }

    // 3. Parse and validate body parameters
    const body = await request.json().catch(() => null)
    const serviceId = body?.serviceId
    const personId = body?.personId
    const isPresent = Boolean(body?.isPresent)
    const clientMarkId = body?.id

    if (!serviceId || !personId) {
      return NextResponse.json(
        { error: 'Bad Request: missing serviceId or personId' },
        { status: 400 }
      )
    }

    // 4. SECTION ENFORCEMENT: attendance_staff can only mark people in their own assigned_section.
    //    super_admin and attendance_admin are cross-section exempt.
    if (callerRole === 'attendance_staff') {
      if (!callerAssignedSection) {
        return NextResponse.json(
          { error: 'Forbidden: staff member has no assigned section configured. Contact an admin.' },
          { status: 403 }
        )
      }

      // Look up the target person's section
      const { data: targetPerson, error: personErr } = await supabaseAdmin
        .from('people')
        .select('id, section')
        .eq('id', personId)
        .eq('status', 'active')
        .maybeSingle()

      if (personErr || !targetPerson) {
        return NextResponse.json(
          { error: 'Bad Request: person not found or not active' },
          { status: 400 }
        )
      }

      if (targetPerson.section !== callerAssignedSection) {
        return NextResponse.json(
          {
            error: `Forbidden: you are assigned to ${callerAssignedSection} and cannot mark attendance for members in ${targetPerson.section}.`,
          },
          { status: 403 }
        )
      }
    }

    // 5. Execute attendance write with server-verified marked_by (never trusted from client)
    const serverMarkedBy = verifiedUser.id

    if (isPresent) {
      // 1. Check if record already exists for (service_id, person_id)
      const { data: existingRecord } = await supabaseAdmin
        .from('attendance')
        .select('id, service_id, person_id, marked_by')
        .eq('service_id', serviceId)
        .eq('person_id', personId)
        .maybeSingle()

      if (existingRecord) {
        // If the exact client-generated ID was already recorded, or member already present,
        // safely discard duplicate and acknowledge success
        if (clientMarkId && existingRecord.id === clientMarkId) {
          return NextResponse.json({
            success: true,
            is_present: true,
            deduplicated: true,
            marked_by: existingRecord.marked_by,
          })
        }

        // Update marked_by and marked_at to reflect latest tap
        const { error: updateErr } = await supabaseAdmin
          .from('attendance')
          .update({
            marked_by: serverMarkedBy,
            marked_at: new Date().toISOString(),
          })
          .eq('id', existingRecord.id)

        if (updateErr) {
          console.error('Error updating attendance mark:', updateErr)
          return NextResponse.json({ error: 'Failed to update attendance' }, { status: 500 })
        }
      } else {
        // Fresh insertion: use client-generated unique UUID as primary key
        const insertPayload: any = {
          service_id: serviceId,
          person_id: personId,
          marked_by: serverMarkedBy,
          marked_at: new Date().toISOString(),
        }

        // If client provided a valid UUID, use it as primary key
        if (
          clientMarkId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            clientMarkId
          )
        ) {
          insertPayload.id = clientMarkId
        }

        const { error: insertErr } = await supabaseAdmin.from('attendance').insert(insertPayload)

        if (insertErr) {
          // If duplicate key collision on (service_id, person_id) or (id), treat as duplicate
          if (insertErr.code === '23505') {
            return NextResponse.json({
              success: true,
              is_present: true,
              deduplicated: true,
              marked_by: serverMarkedBy,
            })
          }
          console.error('Error marking attendance:', insertErr)
          return NextResponse.json({ error: 'Failed to mark attendance' }, { status: 500 })
        }
      }
    } else {
      // Mark absent: delete row from attendance table
      const { error: deleteErr } = await supabaseAdmin
        .from('attendance')
        .delete()
        .eq('service_id', serviceId)
        .eq('person_id', personId)

      if (deleteErr) {
        console.error('Error unmarking attendance:', deleteErr)
        return NextResponse.json({ error: 'Failed to unmark attendance' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      is_present: isPresent,
      marked_by: serverMarkedBy,
    })
  } catch (err) {
    console.error('Error in /api/attendance/toggle:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
