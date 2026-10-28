import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeRole } from '@/lib/roles'
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

function writeFallbackQueue(items: any[]) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true })
    }
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(items, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write fallback pending queue:', err)
  }
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate caller: head_usher or admin
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    let callerId: string = ''
    let callerRole: string = ''

    if (token) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
      if (!authErr && authData?.user) {
        callerId = authData.user.id
        const { data: sr } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('user_id', callerId)
          .maybeSingle()
        if (sr?.role) callerRole = sr.role

        // Dev override check for local testing
        try {
          const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
          if (fs.existsSync(devFile)) {
            const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
            const devEntry =
              devMap[callerId] || (authData.user.email && devMap[authData.user.email.toLowerCase()])
            if (devEntry?.role) callerRole = devEntry.role
          }
        } catch (_) {}
      }
    }

    if (!callerId) {
      return NextResponse.json(
        { error: 'Unauthorized: authentication required to perform approval actions' },
        { status: 401 }
      )
    }

    // Role check: super_admin and attendance_admin are permitted
    const effectiveRole = normalizeRole(callerRole)
    const ALLOWED_INTAKE_ACTION_ROLES = ['super_admin', 'attendance_admin']
    if (!effectiveRole || !ALLOWED_INTAKE_ACTION_ROLES.includes(effectiveRole)) {
      return NextResponse.json(
        { error: 'Forbidden: super_admin or attendance_admin role required to approve submissions.' },
        { status: 403 }
      )
    }

    // 2. Parse body
    const body = await request.json().catch(() => null)
    const pendingId = body?.pendingId
    const action = body?.action // 'approve_new' | 'merge' | 'reject'
    const notes = body?.notes || ''

    if (!pendingId || !['approve_new', 'merge', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request: pendingId and valid action are required.' },
        { status: 400 }
      )
    }

    // 3. Retrieve pending submission
    let pendingItem: any = null
    try {
      const { data, error } = await supabaseAdmin
        .from('pending_people')
        .select('*')
        .eq('id', pendingId)
        .maybeSingle()
      if (!error && data) pendingItem = data
    } catch (_) {}

    if (!pendingItem) {
      const fallbackList = readFallbackQueue()
      pendingItem = fallbackList.find((i) => i.id === pendingId)
    }

    if (!pendingItem) {
      return NextResponse.json({ error: 'Pending submission not found.' }, { status: 404 })
    }

    // Idempotency check: reject double-submissions gracefully
    if (pendingItem.status && pendingItem.status !== 'pending') {
      return NextResponse.json(
        {
          error: `This submission has already been ${pendingItem.status}. No further action is needed.`,
          alreadyResolved: true,
          currentStatus: pendingItem.status,
        },
        { status: 400 }
      )
    }

    let createdPerson: any = null

    // 4. Handle Action
    if (action === 'approve_new') {
      // Find unit_id
      let { data: unitRecord } = await supabaseAdmin
        .from('units')
        .select('id')
        .eq('name', pendingItem.unit_name)
        .maybeSingle()

      if (!unitRecord) {
        // Fallback to Visitor or Member
        const { data: defUnit } = await supabaseAdmin
          .from('units')
          .select('id')
          .eq('name', 'Visitor')
          .maybeSingle()
        unitRecord = defUnit
      }

      // Insert new person into people table
      const personPayload: any = {
        full_name: pendingItem.full_name,
        phone: pendingItem.phone,
        unit_id: unitRecord?.id || null,
        status: 'active',
      }

      // Try inserting with section column
      try {
        const { data: newP, error: pErr } = await supabaseAdmin
          .from('people')
          .insert({ ...personPayload, section: pendingItem.section })
          .select('id, full_name, phone, unit_id')
          .single()

        if (!pErr && newP) {
          createdPerson = newP
        }
      } catch (_) {}

      if (!createdPerson) {
        const { data: baseP, error: baseErr } = await supabaseAdmin
          .from('people')
          .insert(personPayload)
          .select('id, full_name, phone, unit_id')
          .single()

        if (baseErr || !baseP) {
          console.error('Failed to create person from intake approval:', baseErr)
          return NextResponse.json(
            { error: 'Failed to create person record in people table', details: baseErr?.message },
            { status: 500 }
          )
        }
        createdPerson = baseP
      }

      // Automatically mark the newly approved person present for the active service session
      try {
        let activeServiceId: string | null = null
        const { data: actSvc } = await supabaseAdmin
          .from('services')
          .select('id')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (actSvc?.id) {
          activeServiceId = actSvc.id
        } else {
          const tempFile = path.join(process.cwd(), '.temp_data', 'active_service.json')
          if (fs.existsSync(tempFile)) {
            const stored = JSON.parse(fs.readFileSync(tempFile, 'utf-8'))
            if (stored?.id) activeServiceId = stored.id
          }
        }

        if (activeServiceId && createdPerson?.id) {
          await supabaseAdmin.from('attendance').upsert(
            {
              service_id: activeServiceId,
              person_id: createdPerson.id,
              marked_by: callerId,
            },
            { onConflict: 'service_id,person_id' }
          )
        }
      } catch (attErr) {
        console.error('Failed to auto-mark attendance on intake approval:', attErr)
      }
    } else if (action === 'merge') {
      // Merge: keep existing record, optionally update unit/section if requested
      if (pendingItem.duplicate_matched_person_id) {
        try {
          await supabaseAdmin
            .from('people')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', pendingItem.duplicate_matched_person_id)
        } catch (_) {}

        // Also mark merged person present in active service session
        try {
          let activeServiceId: string | null = null
          const { data: actSvc } = await supabaseAdmin
            .from('services')
            .select('id')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (actSvc?.id) {
            activeServiceId = actSvc.id
          } else {
            const tempFile = path.join(process.cwd(), '.temp_data', 'active_service.json')
            if (fs.existsSync(tempFile)) {
              const stored = JSON.parse(fs.readFileSync(tempFile, 'utf-8'))
              if (stored?.id) activeServiceId = stored.id
            }
          }

          if (activeServiceId) {
            await supabaseAdmin.from('attendance').upsert(
              {
                service_id: activeServiceId,
                person_id: pendingItem.duplicate_matched_person_id,
                marked_by: callerId,
              },
              { onConflict: 'service_id,person_id' }
            )
          }
        } catch (_) {}
      }
    }

    // 5. Update pending record status
    const newStatus = action === 'approve_new' ? 'approved' : action === 'merge' ? 'merged' : 'rejected'
    const updatePayload = {
      status: newStatus,
      reviewed_by: callerId,
      reviewed_at: new Date().toISOString(),
      notes,
      updated_at: new Date().toISOString(),
    }

    try {
      await supabaseAdmin
        .from('pending_people')
        .update(updatePayload)
        .eq('id', pendingId)
    } catch (_) {}

    // Also update fallback queue if present
    const fallbackList = readFallbackQueue()
    const updatedFallback = fallbackList.map((i) =>
      i.id === pendingId ? { ...i, ...updatePayload } : i
    )
    writeFallbackQueue(updatedFallback)

    return NextResponse.json({
      success: true,
      action,
      createdPerson,
      status: newStatus,
    })
  } catch (err: any) {
    console.error('Error in /api/intake/action:', err)
    return NextResponse.json({ error: 'Internal server error', details: err?.message }, { status: 500 })
  }
}
