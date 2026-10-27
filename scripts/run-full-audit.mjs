import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE_URL = 'http://localhost:3000'

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function getOrCreateSessionForRole(email, role, section = 'Adults & Youth') {
  // 1. Ensure user exists
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
  let user = usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  if (!user) {
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: `Test ${role}` },
    })
    if (createErr) throw createErr
    user = newUser.user
  }

  // 2. Try to ensure staff_role in DB (if DB constraint allows)
  try {
    await supabaseAdmin
      .from('staff_roles')
      .upsert({ user_id: user.id, role, assigned_section: section }, { onConflict: 'user_id' })
  } catch (_) {}

  // Also write to local dev_roles.json so local test runner recognizes the role
  try {
    const devDir = path.join(process.cwd(), '.temp_data')
    if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true })
    const devFile = path.join(devDir, 'dev_roles.json')
    let map = {}
    if (fs.existsSync(devFile)) {
      try { map = JSON.parse(fs.readFileSync(devFile, 'utf-8')) } catch {}
    }
    map[user.id] = { role, section }
    map[email.toLowerCase()] = { role, section }
    fs.writeFileSync(devFile, JSON.stringify(map, null, 2))
  } catch (_) {}

  // 3. Generate session token
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr) throw linkErr

  const { data: sessData, error: sessErr } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  })
  if (sessErr || !sessData.session) throw sessErr || new Error('No session')

  return { user, session: sessData.session, token: sessData.session.access_token }
}

async function testFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, options)
  let body
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function run() {
  console.log('====================================================')
  console.log('GRACE ASSEMBLY PRE-LAUNCH AUTOMATED AUDIT SUITE')
  console.log('====================================================\n')

  const results = {
    unauthenticated: [],
    roleGating: [],
    attendanceSectionGate: [],
    edgeCases: [],
    dataIntegrity: [],
  }

  // Set up test tokens for each role
  console.log('1. Setting up role sessions...')
  const roles = {
    usher: await getOrCreateSessionForRole('audit_usher@test.com', 'usher', 'Adults & Youth'),
    head_usher: await getOrCreateSessionForRole('audit_head_usher@test.com', 'head_usher', 'Adults & Youth'),
    pastor: await getOrCreateSessionForRole('audit_pastor@test.com', 'pastor', 'Adults & Youth'),
    secretary: await getOrCreateSessionForRole('audit_secretary@test.com', 'secretary', 'Adults & Youth'),
    admin: await getOrCreateSessionForRole('audit_admin@test.com', 'admin', 'Adults & Youth'),
  }
  console.log('Sessions created for all 5 roles.\n')

  // -------------------------------------------------------------------------
  // SECTION 2A: Unauthenticated Request Checks (Must return 401/403)
  // -------------------------------------------------------------------------
  console.log('2. Checking Unauthenticated API calls (expect 401/403)...')
  const unauthEndpoints = [
    { name: 'GET /api/dashboard/stats', path: '/api/dashboard/stats', method: 'GET' },
    { name: 'GET /api/intake/pending', path: '/api/intake/pending', method: 'GET' },
    { name: 'POST /api/intake/action', path: '/api/intake/action', method: 'POST', body: {} },
    { name: 'GET /api/staff-requests/pending', path: '/api/staff-requests/pending', method: 'GET' },
    { name: 'POST /api/staff-requests/action', path: '/api/staff-requests/action', method: 'POST', body: {} },
    { name: 'POST /api/attendance/toggle', path: '/api/attendance/toggle', method: 'POST', body: {} },
    { name: 'POST /api/attendance/visitor', path: '/api/attendance/visitor', method: 'POST', body: {} },
  ]

  for (const ep of unauthEndpoints) {
    const res = await testFetch(ep.path, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    })
    const pass = res.status === 401 || res.status === 403
    console.log(`  ${ep.name} -> Status ${res.status} [${pass ? 'PASS' : 'FAIL'}]`)
    results.unauthenticated.push({ endpoint: ep.name, status: res.status, pass })
  }

  // -------------------------------------------------------------------------
  // SECTION 2B: Role-Gate Re-verification
  // -------------------------------------------------------------------------
  console.log('\n3. Testing Role-Gate Matrix...')

  // /api/dashboard/stats: 403 for usher, head_usher; 200 for admin, pastor, secretary
  console.log('  Testing /api/dashboard/stats:')
  for (const [roleName, userObj] of Object.entries(roles)) {
    const res = await testFetch('/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${userObj.token}` },
    })
    const expected = ['admin', 'pastor', 'secretary'].includes(roleName) ? 200 : 403
    const pass = res.status === expected
    console.log(`    Role: ${roleName} -> Status ${res.status} (expected ${expected}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleGating.push({ route: '/api/dashboard/stats', role: roleName, status: res.status, expected, pass })
  }

  // /api/intake/pending: 200 for head_usher; 403 for usher, admin, pastor, secretary
  console.log('  Testing /api/intake/pending:')
  for (const [roleName, userObj] of Object.entries(roles)) {
    const res = await testFetch('/api/intake/pending', {
      headers: { Authorization: `Bearer ${userObj.token}` },
    })
    const expected = roleName === 'head_usher' ? 200 : 403
    const pass = res.status === expected
    console.log(`    Role: ${roleName} -> Status ${res.status} (expected ${expected}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleGating.push({ route: '/api/intake/pending', role: roleName, status: res.status, expected, pass })
  }

  // /api/staff-requests/pending: 200 for pastor, secretary; 403 for usher, head_usher, admin
  console.log('  Testing /api/staff-requests/pending:')
  for (const [roleName, userObj] of Object.entries(roles)) {
    const res = await testFetch('/api/staff-requests/pending', {
      headers: { Authorization: `Bearer ${userObj.token}` },
    })
    const expected = ['pastor', 'secretary'].includes(roleName) ? 200 : 403
    const pass = res.status === expected
    console.log(`    Role: ${roleName} -> Status ${res.status} (expected ${expected}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleGating.push({ route: '/api/staff-requests/pending', role: roleName, status: res.status, expected, pass })
  }

  // -------------------------------------------------------------------------
  // SECTION 2C: Usher Section Boundary Check
  // -------------------------------------------------------------------------
  console.log('\n4. Testing Usher Section-Gate Boundary Enforcement...')
  // Usher assigned to 'Adults & Youth' tries to mark attendance for a person in 'Infants'
  // Find a person in Infants section
  const { data: infantsPeople } = await supabaseAdmin
    .from('people')
    .select('id, full_name, section')
    .eq('section', 'Infants')
    .eq('status', 'active')
    .limit(1)

  let infantsPerson = infantsPeople?.[0]
  if (!infantsPerson) {
    // Create a temporary infants person to test
    const { data: created } = await supabaseAdmin
      .from('people')
      .insert({
        full_name: 'Test Infant Audit Person',
        phone: '09099998888',
        section: 'Infants',
        status: 'active',
      })
      .select()
      .single()
    infantsPerson = created
  }

  // Get active service
  const { data: serviceData } = await supabaseAdmin
    .from('services')
    .select('id')
    .order('service_date', { ascending: false })
    .limit(1)
    .single()

  const serviceId = serviceData.id

  // Call /api/attendance/toggle with Usher's token (assigned to Adults & Youth) on Infants person
  const toggleRes = await testFetch('/api/attendance/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${roles.usher.token}`,
    },
    body: JSON.stringify({
      personId: infantsPerson.id,
      serviceId: serviceId,
      attended: true,
    }),
  })

  const sectionGatePass = toggleRes.status === 403
  console.log(`  Usher (Adults & Youth) marking Infants person -> Status ${toggleRes.status} (expected 403) [${sectionGatePass ? 'PASS' : 'FAIL'}]`)
  results.attendanceSectionGate.push({
    test: 'Usher Cross-Section Tamper Rejection',
    status: toggleRes.status,
    pass: sectionGatePass,
  })

  // -------------------------------------------------------------------------
  // SECTION 3: Supabase RLS Direct Enforcement
  // -------------------------------------------------------------------------
  console.log('\n5. Testing Supabase RLS directly with Usher user token...')
  // Create Supabase client using Usher's token
  const usherSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${roles.usher.token}` } },
  })

  // Direct select from attendance table for a different section
  // Query attendance rows
  const { data: rlsAttendance, error: rlsErr } = await usherSupabase
    .from('attendance')
    .select('*')

  console.log(`  Direct select on attendance table as Usher: ${rlsAttendance?.length ?? 0} rows visible (error: ${rlsErr?.message || 'none'})`)

  // -------------------------------------------------------------------------
  // SECTION 6: Edge Cases
  // -------------------------------------------------------------------------
  console.log('\n6. Testing Edge Cases...')
  
  // 6A. Phone normalization duplicate check
  console.log('  Testing Phone Normalization Duplicate Check (+234 vs 0 prefix vs spaces):')
  const phoneTests = [
    '+2348000000001',
    '08000000001',
    '0800 000 0001',
    '+234 800 000 0001',
  ]
  for (const pt of phoneTests) {
    const res = await testFetch('/api/intake/lookup-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pt }),
    })
    console.log(`    Lookup '${pt}' -> matched: ${res.body?.matched} [${res.body?.matched ? 'PASS' : 'FAIL'}]`)
    results.edgeCases.push({ test: `Phone lookup '${pt}'`, matched: res.body?.matched, pass: Boolean(res.body?.matched) })
  }

  // 6B. Double-review / Idempotency check on pending_people
  console.log('  Testing Double-Action Idempotency on Intake Action:')
  // Create a dummy pending person
  const { data: dummyPending } = await supabaseAdmin
    .from('pending_people')
    .insert({
      full_name: 'Idempotency Test Person',
      phone: '08129998877',
      section: 'Adults & Youth',
      submitted_by: roles.usher.user.id,
      status: 'pending',
    })
    .select()
    .single()

  if (dummyPending) {
    // 1st action: approve
    const act1 = await testFetch('/api/intake/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${roles.head_usher.token}`,
      },
      body: JSON.stringify({ id: dummyPending.id, action: 'approve' }),
    })
    console.log(`    Action 1 (first reviewer approve) -> Status ${act1.status} [${act1.status === 200 ? 'PASS' : 'FAIL'}]`)

    // 2nd action: try to reject the same item immediately
    const act2 = await testFetch('/api/intake/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${roles.head_usher.token}`,
      },
      body: JSON.stringify({ id: dummyPending.id, action: 'reject' }),
    })
    const isIdempotent = act2.status === 400 && act2.body?.error?.toLowerCase().includes('already')
    console.log(`    Action 2 (second reviewer conflict) -> Status ${act2.status}, error: "${act2.body?.error}" [${isIdempotent ? 'PASS' : 'FAIL'}]`)
    results.edgeCases.push({ test: 'Double-action idempotency', status: act2.status, error: act2.body?.error, pass: isIdempotent })

    // Clean up created member from people
    await supabaseAdmin.from('people').delete().eq('phone', '08129998877')
    await supabaseAdmin.from('pending_people').delete().eq('id', dummyPending.id)
  }

  // Cleanup test infant person if created
  if (infantsPerson?.full_name === 'Test Infant Audit Person') {
    await supabaseAdmin.from('people').delete().eq('id', infantsPerson.id)
  }

  console.log('\n====================================================')
  console.log('AUDIT RUN COMPLETED SUMMARY:')
  const allTests = [
    ...results.unauthenticated,
    ...results.roleGating,
    ...results.attendanceSectionGate,
    ...results.edgeCases,
  ]
  const passedCount = allTests.filter((t) => t.pass).length
  console.log(`Total: ${allTests.length} tests, Passed: ${passedCount}, Failed: ${allTests.length - passedCount}`)
  console.log('====================================================')
}

run().catch((e) => {
  console.error('Fatal audit suite error:', e)
  process.exit(1)
})
