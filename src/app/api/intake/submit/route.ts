import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

// Local fallback store in case Supabase migration has not been applied yet
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
    // 1. Authenticate caller
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim()

    let callerId: string = ''
    let callerEmail: string = ''

    if (token) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
      if (!authErr && authData?.user) {
        callerId = authData.user.id
        callerEmail = authData.user.email ?? ''
      }
    }

    if (!callerId) {
      return NextResponse.json(
        { error: 'Unauthorized: authentication required to submit intake forms' },
        { status: 401 }
      )
    }

    // 2. Parse body
    const body = await request.json().catch(() => null)
    const fullName = (body?.fullName ?? '').trim()
    const phone = (body?.phone ?? '').trim()
    const section = (body?.section ?? 'Adults & Youth').trim()
    const unitName = (body?.unit ?? 'Visitor').trim()
    const statusFlag = body?.statusFlag === 'returning' ? 'returning' : 'first_time'
    const duplicateMatchedPersonId = body?.duplicateMatchedPersonId || null
    const collectorName = (body?.collectorName ?? callerEmail).trim()
    const collectorSection = (body?.collectorSection ?? section).trim()

    if (!fullName || !phone) {
      return NextResponse.json(
        { error: 'Full name and phone number are required.' },
        { status: 400 }
      )
    }

    const newPendingRecord = {
      id: crypto.randomUUID(),
      full_name: fullName,
      phone,
      section,
      unit_name: unitName,
      status_flag: statusFlag,
      duplicate_matched_person_id: duplicateMatchedPersonId,
      submitted_by: callerId,
      submitted_by_name: collectorName,
      submitted_by_section: collectorSection,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // 3. Attempt database write into pending_people
    let dbSuccess = false
    try {
      const { data, error } = await supabaseAdmin
        .from('pending_people')
        .insert(newPendingRecord)
        .select()
        .single()

      if (!error && data) {
        dbSuccess = true
        return NextResponse.json({
          success: true,
          pendingId: data.id,
          pendingPerson: data,
          storage: 'database',
        })
      }
    } catch (_) {}

    // Fallback if table does not exist yet
    if (!dbSuccess) {
      const queue = readFallbackQueue()
      queue.unshift(newPendingRecord)
      writeFallbackQueue(queue)

      return NextResponse.json({
        success: true,
        pendingId: newPendingRecord.id,
        pendingPerson: newPendingRecord,
        storage: 'fallback_queue',
      })
    }
  } catch (err: any) {
    console.error('Error in /api/intake/submit:', err)
    return NextResponse.json(
      { error: 'Failed to submit intake form', details: err?.message },
      { status: 500 }
    )
  }
}
