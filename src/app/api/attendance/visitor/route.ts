import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    // 1. Authenticate caller
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: missing token' }, { status: 401 })
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 })
    }

    const verifiedUser = authData.user

    // 2. Parse body
    const body = await request.json().catch(() => null)
    const serviceId = body?.serviceId
    const fullName = (body?.fullName ?? '').trim()
    const section = (body?.section ?? 'Adults & Youth').trim()
    let phone = (body?.phone ?? '').trim()

    if (!serviceId || !fullName) {
      return NextResponse.json(
        { error: 'Bad Request: fullName and serviceId are required' },
        { status: 400 }
      )
    }

    // Ensure phone is unique; if empty, generate a unique visitor phone placeholder
    if (!phone) {
      phone = `+234V${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`
    }

    // 3. Find 'Visitor' unit ID
    let { data: visitorUnit } = await supabaseAdmin
      .from('units')
      .select('id')
      .eq('name', 'Visitor')
      .maybeSingle()

    if (!visitorUnit) {
      const { data: createdUnit } = await supabaseAdmin
        .from('units')
        .insert({ name: 'Visitor' })
        .select('id')
        .single()
      visitorUnit = createdUnit
    }

    // 4. Insert into people table
    const personPayload: any = {
      full_name: fullName,
      phone,
      unit_id: visitorUnit?.id ?? null,
      status: 'active',
    }

    // Try inserting with section column if supported
    let insertedPerson: any = null
    try {
      const { data, error } = await supabaseAdmin
        .from('people')
        .insert({ ...personPayload, section })
        .select('id, full_name, unit_id')
        .single()
      if (!error && data) {
        insertedPerson = data
      }
    } catch (_) {}

    if (!insertedPerson) {
      const { data, error } = await supabaseAdmin
        .from('people')
        .insert(personPayload)
        .select('id, full_name, unit_id')
        .single()

      if (error || !data) {
        console.error('Error inserting visitor person:', error)
        return NextResponse.json({ error: 'Failed to create visitor record' }, { status: 500 })
      }
      insertedPerson = data
    }

    // 5. Immediately mark the new visitor present for this service
    await supabaseAdmin.from('attendance').upsert(
      {
        service_id: serviceId,
        person_id: insertedPerson.id,
        marked_by: verifiedUser.id,
        marked_at: new Date().toISOString(),
      },
      { onConflict: 'service_id,person_id' }
    )

    return NextResponse.json({
      success: true,
      person: {
        id: insertedPerson.id,
        full_name: insertedPerson.full_name,
        unit_name: 'Visitor',
        section,
        is_present: true,
      },
    })
  } catch (err) {
    console.error('Error in /api/attendance/visitor:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
