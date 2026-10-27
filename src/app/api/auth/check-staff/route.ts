import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const rawEmail = body?.email

    if (!rawEmail || typeof rawEmail !== 'string') {
      return NextResponse.json(
        { isStaff: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      )
    }

    const email = rawEmail.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { isStaff: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      )
    }

    // 1. Verify email exists in people table
    const { data: person, error: personError } = await supabaseAdmin
      .from('people')
      .select('id, full_name, email')
      .ilike('email', email)
      .maybeSingle()

    if (personError) {
      console.error('Error querying people table:', personError)
      return NextResponse.json(
        {
          isStaff: false,
          error: 'Unable to connect. Please check your internet connection and try again.',
        },
        { status: 500 }
      )
    }

    let devPerson: any = null
    try {
      const fs = await import('fs')
      const path = await import('path')
      const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
      if (fs.existsSync(devFile)) {
        const rolesMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        const devEntry = rolesMap[email]
        if (devEntry?.role) {
          devPerson = {
            id: 'dev-' + email,
            full_name: devEntry.name || email,
            email,
          }
        }
      }
    } catch (_) {}

    const resolvedPerson = person || devPerson

    if (!resolvedPerson) {
      return NextResponse.json({
        isStaff: false,
        error: "This email isn't registered as staff. Contact the church office.",
      })
    }

    // 2. Verify person has an assigned staff role (admin or usher)
    let role: string | null = null

    // Check staff_roles by person_id (if table supports person_id)
    if (person) {
      try {
        const { data: roleByPerson, error: rolePersonErr } = await supabaseAdmin
          .from('staff_roles')
          .select('role')
          .eq('person_id', person.id)
          .maybeSingle()

        if (!rolePersonErr && roleByPerson?.role) {
          role = roleByPerson.role
        }
      } catch {
        // Column person_id might not exist yet
      }
    }

    // Check staff_roles by user_id linked to auth.users
    if (!role) {
      const { data: userList, error: usersErr } = await supabaseAdmin.auth.admin.listUsers()
      if (!usersErr && userList?.users) {
        const authUser = userList.users.find((u) => u.email?.toLowerCase() === email)
        if (authUser) {
          const { data: roleByUser } = await supabaseAdmin
            .from('staff_roles')
            .select('role')
            .eq('user_id', authUser.id)
            .maybeSingle()
          if (roleByUser?.role) {
            role = roleByUser.role
          }
        }
      }
    }

    // Check dev fallback if role not found in DB
    if (!role) {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const devFile = path.join(process.cwd(), '.temp_data', 'dev_roles.json')
        if (fs.existsSync(devFile)) {
          const rolesMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
          const devEntry = rolesMap[email]
          if (devEntry?.role) {
            role = devEntry.role
          }
        }
      } catch (_) {}
    }

    if (!role) {
      return NextResponse.json({
        isStaff: false,
        error: "This email isn't registered as staff. Contact the church office.",
      })
    }

    return NextResponse.json({
      isStaff: true,
      role,
      name: resolvedPerson.full_name,
    })
  } catch (err) {
    console.error('Unhandled error in check-staff API:', err)
    return NextResponse.json(
      {
        isStaff: false,
        error: 'Unable to connect. Please check your internet connection and try again.',
      },
      { status: 500 }
    )
  }
}
