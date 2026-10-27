import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

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

export async function GET(request: Request) {
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

        // Check staff_roles table in Supabase
        const { data: sr } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('user_id', callerId)
          .maybeSingle()
        if (sr?.role) callerRole = sr.role

        // Dev override check for local testing and resilience
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

    // Optional query param / header override for local test runner if provided
    const devRoleHeader = request.headers.get('x-dev-role')
    if (devRoleHeader && process.env.NODE_ENV !== 'production') {
      callerRole = devRoleHeader
    }

    // STRICT PERMISSION CHECK: Only 'pastor' and 'secretary' are permitted.
    // admin, head_usher, usher, and unauthenticated callers MUST get 403.
    const ALLOWED_STAFF_APPROVAL_ROLES = ['pastor', 'secretary']
    if (!callerRole || !ALLOWED_STAFF_APPROVAL_ROLES.includes(callerRole)) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Pastor or Secretary role required to access staff approvals. Admin, Head Usher, and Usher roles are not permitted.',
          callerRole: callerRole || 'unauthenticated',
        },
        { status: 403 }
      )
    }

    // 2. Query pending requests from DB
    let pendingRequests: any[] = []
    try {
      const { data, error } = await supabaseAdmin
        .from('pending_staff_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (!error && data) {
        pendingRequests = data
      }
    } catch (_) {}

    // Read and merge fallback queue
    const fallbackList = readFallbackRequests()
    const pendingFallback = fallbackList.filter((r) => r.status === 'pending')

    for (const fbItem of pendingFallback) {
      if (!pendingRequests.some((dbItem) => dbItem.id === fbItem.id || dbItem.email?.toLowerCase() === fbItem.email?.toLowerCase())) {
        pendingRequests.push(fbItem)
      }
    }

    // Sort newest first
    pendingRequests.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    return NextResponse.json({
      requests: pendingRequests,
      count: pendingRequests.length,
      viewerRole: callerRole,
    })
  } catch (err: any) {
    if (err?.digest?.startsWith?.('NEXT_') || err?.message?.includes('prerender')) {
      throw err
    }
    console.error('Error in GET /api/staff-requests/pending:', err)
    return NextResponse.json(
      { error: 'Failed to fetch pending staff requests', details: err?.message },
      { status: 500 }
    )
  }
}
