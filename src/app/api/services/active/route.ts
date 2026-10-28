import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeRole } from '@/lib/roles'
import fs from 'fs'
import path from 'path'

const TEMP_ACTIVE_FILE = path.join(process.cwd(), '.temp_data', 'active_service.json')

function getStoredActiveService(): any | null {
  try {
    if (fs.existsSync(TEMP_ACTIVE_FILE)) {
      return JSON.parse(fs.readFileSync(TEMP_ACTIVE_FILE, 'utf-8'))
    }
  } catch (_) {}
  return null
}

function setStoredActiveService(service: any | null) {
  try {
    const dir = path.dirname(TEMP_ACTIVE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (service) {
      fs.writeFileSync(TEMP_ACTIVE_FILE, JSON.stringify(service, null, 2))
    } else if (fs.existsSync(TEMP_ACTIVE_FILE)) {
      fs.unlinkSync(TEMP_ACTIVE_FILE)
    }
  } catch (_) {}
}

export async function GET() {
  try {
    // 1. Check database for active service
    try {
      const { data: dbActive, error } = await supabaseAdmin
        .from('services')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && dbActive) {
        setStoredActiveService(dbActive)
        return NextResponse.json({ activeService: dbActive })
      }
    } catch (_) {}

    // 2. Check local fallback
    const stored = getStoredActiveService()
    if (stored) {
      return NextResponse.json({ activeService: stored })
    }

    return NextResponse.json({ activeService: null })
  } catch (err) {
    console.error('Error fetching active service:', err)
    return NextResponse.json({ error: 'Failed to fetch active service' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate caller: super_admin or attendance_admin ONLY
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: missing authorization token' }, { status: 401 })
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 })
    }

    const user = authData.user
    let callerRole = ''

    const { data: sr } = await supabaseAdmin
      .from('staff_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (sr?.role) callerRole = sr.role

    // Dev override check
    try {
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const devMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry = devMap[user.id] || (user.email && devMap[user.email.toLowerCase()])
        if (devEntry?.role) callerRole = devEntry.role
      }
    } catch (_) {}

    const effectiveRole = normalizeRole(callerRole)
    if (effectiveRole !== 'super_admin' && effectiveRole !== 'attendance_admin') {
      return NextResponse.json(
        { error: 'Forbidden: only super_admin or attendance_admin can start service sessions' },
        { status: 403 }
      )
    }

    // 2. Parse body
    const body = await request.json().catch(() => ({}))
    const now = new Date()
    const type = (body.type || 'Sunday Service').trim()
    const serviceDate = body.serviceDate || now.toISOString().split('T')[0]
    const serviceTime = body.serviceTime || now.toTimeString().split(' ')[0]

    // 3. Close any active services
    try {
      await supabaseAdmin
        .from('services')
        .update({ status: 'closed' })
        .eq('status', 'active')
    } catch (_) {}

    // 4. Create new service with status = 'active'
    let newService: any = null
    try {
      const { data, error } = await supabaseAdmin
        .from('services')
        .insert({
          type,
          service_date: serviceDate,
          service_time: serviceTime,
          status: 'active',
        })
        .select()
        .single()

      if (!error && data) {
        newService = data
      }
    } catch (_) {}

    // Fallback if status column is pending migration
    if (!newService) {
      const { data: fallbackData } = await supabaseAdmin
        .from('services')
        .insert({
          type,
          service_date: serviceDate,
          service_time: serviceTime,
        })
        .select()
        .single()

      newService = fallbackData ? { ...fallbackData, status: 'active' } : null
    }

    if (!newService) {
      // Local fallback id
      newService = {
        id: crypto.randomUUID(),
        type,
        service_date: serviceDate,
        service_time: serviceTime,
        status: 'active',
        created_at: new Date().toISOString(),
      }
    }

    setStoredActiveService(newService)

    return NextResponse.json({
      success: true,
      service: newService,
    })
  } catch (err: any) {
    console.error('Error starting service session:', err)
    return NextResponse.json({ error: 'Failed to start service session', details: err?.message }, { status: 500 })
  }
}
