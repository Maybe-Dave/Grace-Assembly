import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@supabase/supabase-js'

// This route is ONLY enabled when NEXT_PUBLIC_ENABLE_DEV_LOGIN=true.
// It is automatically disabled in every Vercel/production build where that var is absent.
const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function POST(request: Request) {
  if (!DEV_LOGIN_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const email = (body?.email || 'dicksondave2002@gmail.com').trim().toLowerCase()
    const targetRole = body?.role || 'admin'
    const targetSection = body?.section || 'Adults & Youth'

    // 1. Generate magic link for user
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('dev-login generateLink error:', linkErr)
      return NextResponse.json(
        { error: 'Failed to generate dev auth link', details: linkErr?.message },
        { status: 500 }
      )
    }

    // 2. Verify OTP to obtain real valid session
    const { data: sessData, error: sessErr } = await sbAnon.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'email',
    })

    if (sessErr || !sessData?.session) {
      console.error('dev-login verifyOtp error:', sessErr)
      return NextResponse.json(
        { error: 'Failed to create dev session', details: sessErr?.message },
        { status: 500 }
      )
    }

    const session = sessData.session
    const userId = session.user.id

    // 3. Ensure role and section in staff_roles
    try {
      await supabaseAdmin.from('staff_roles').upsert({
        user_id: userId,
        role: targetRole,
        assigned_section: targetSection,
      })
    } catch (_) {}

    // Store local dev role mapping for resilient development & testing
    try {
      const fs = await import('fs')
      const path = await import('path')
      const devDir = path.join(process.cwd(), '.temp_data')
      if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true })
      const devFile = path.join(devDir, 'dev_roles.json')
      let rolesMap: any = {}
      if (fs.existsSync(devFile)) {
        try {
          rolesMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        } catch {}
      }
      rolesMap[userId] = { role: targetRole, section: targetSection }
      if (session.user.email) {
        rolesMap[session.user.email.toLowerCase()] = { role: targetRole, section: targetSection }
      }
      fs.writeFileSync(devFile, JSON.stringify(rolesMap, null, 2))
    } catch (_) {}

    return NextResponse.json({
      success: true,
      session,
      user: {
        id: userId,
        email: session.user.email,
        role: targetRole,
        assigned_section: targetSection,
      },
    })
  } catch (err: any) {
    console.error('Error in /api/auth/dev-login:', err)
    return NextResponse.json(
      { error: 'Internal server error', details: err?.message },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  if (!DEV_LOGIN_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const url = new URL(request.url)
    const email = url.searchParams.get('email') || 'dicksondave2002@gmail.com'
    const role = url.searchParams.get('role') || 'admin'
    const section = url.searchParams.get('section') || 'Adults & Youth'

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })

    if (linkErr || !linkData?.properties?.hashed_token) {
      return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 })
    }

    const { data: sessData, error: sessErr } = await sbAnon.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'email',
    })

    if (sessErr || !sessData?.session) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const session = sessData.session
    const userId = session.user.id

    // Update staff_roles and dev_roles.json
    try {
      await supabaseAdmin.from('staff_roles').upsert({
        user_id: userId,
        role,
        assigned_section: section,
      })
    } catch (_) {}

    try {
      const fs = await import('fs')
      const path = await import('path')
      const devDir = path.join(process.cwd(), '.temp_data')
      if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true })
      const devFile = path.join(devDir, 'dev_roles.json')
      let rolesMap: any = {}
      if (fs.existsSync(devFile)) {
        try {
          rolesMap = JSON.parse(fs.readFileSync(devFile, 'utf-8'))
        } catch {}
      }
      rolesMap[userId] = { role, section }
      if (session.user.email) {
        rolesMap[session.user.email.toLowerCase()] = { role, section }
      }
      fs.writeFileSync(devFile, JSON.stringify(rolesMap, null, 2))
    } catch (_) {}

    // If browser requested redirect, return an HTML page that sets localStorage and redirects
    if (url.searchParams.get('redirect') === 'true') {
      const redirectPath = url.searchParams.get('redirectPath') || '/attendance'
      const html = `<!DOCTYPE html>
<html>
<head><title>Logging in...</title></head>
<body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #F7F3EC; color: #1F2A24;">
  <p>Logging into Grace Assembly Dev Environment...</p>
  <script>
    try {
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', ${JSON.stringify(JSON.stringify(session))});
      window.location.href = '${redirectPath}';
    } catch(e) {
      document.body.innerHTML = 'Error storing session: ' + e.message;
    }
  </script>
</body>
</html>`
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return NextResponse.json({ success: true, session })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
