import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function getEnv() {
  const envFile = path.join(process.cwd(), '.env.local')
  const content = fs.readFileSync(envFile, 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      env[key] = val
    }
  }
  return env
}

const env = getEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
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
      user_metadata: { full_name: `Test ${role || 'NullRole'}` },
    })
    if (createErr) throw createErr
    user = newUser.user
  }

  // 2. Try to update DB staff_role if non-null and constraint allows
  try {
    if (role !== null) {
      await supabaseAdmin
        .from('staff_roles')
        .upsert({ user_id: user.id, role, assigned_section: section }, { onConflict: 'user_id' })
    }
  } catch (_) {}

  // Also write to local dev_roles.json for offline/local resolution
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

  return { user, session: sessData.session, token: sessData.session.access_token, role }
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
  console.log('====================================================================')
  console.log('GRACE ASSEMBLY TWO-TIER PERMISSIONS & POSITIONS VERIFICATION SUITE')
  console.log('====================================================================\n')

  const results = {
    unauthenticated: [],
    roleMatrix: [],
    nullRoleRevocation: [],
    attendanceSectionGate: [],
    positionsFunctionality: [],
    edgeCases: [],
  }

  // 1. Create sessions for all new roles and former roles (now role = NULL)
  console.log('1. Setting up role sessions for verification...')
  const roles = {
    super_admin: await getOrCreateSessionForRole('audit_super_admin@test.com', 'super_admin', 'Adults & Youth'),
    attendance_admin: await getOrCreateSessionForRole('audit_attendance_admin@test.com', 'attendance_admin', 'Adults & Youth'),
    attendance_staff: await getOrCreateSessionForRole('audit_attendance_staff@test.com', 'attendance_staff', 'Adults & Youth'),
    finance_admin: await getOrCreateSessionForRole('audit_finance_admin@test.com', 'finance_admin', 'Adults & Youth'),
    events_admin: await getOrCreateSessionForRole('audit_events_admin@test.com', 'events_admin', 'Adults & Youth'),
    pastor_now_null: await getOrCreateSessionForRole('audit_pastor@test.com', null, 'Adults & Youth'),
    secretary_now_null: await getOrCreateSessionForRole('audit_secretary@test.com', null, 'Adults & Youth'),
  }
  console.log('Sessions verified for all 7 role identity test cases.\n')

  // -------------------------------------------------------------------------
  // 2. Unauthenticated checks (Must return 401/403)
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
  // 3. New Role Access Matrix
  // -------------------------------------------------------------------------
  console.log('\n3. Testing Role Access Matrix across Protected Routes...')

  // 3A. /api/dashboard/stats: super_admin (200), attendance_admin (200), attendance_staff (403), finance_admin (403), events_admin (403)
  console.log('  Testing /api/dashboard/stats:')
  const dashboardExpected = {
    super_admin: 200,
    attendance_admin: 200,
    attendance_staff: 403,
    finance_admin: 403,
    events_admin: 403,
  }
  for (const [rName, expStatus] of Object.entries(dashboardExpected)) {
    const res = await testFetch('/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${roles[rName].token}` },
    })
    const pass = res.status === expStatus
    console.log(`    Role: ${rName} -> Status ${res.status} (expected ${expStatus}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleMatrix.push({ route: '/api/dashboard/stats', role: rName, status: res.status, expected: expStatus, pass })
  }

  // 3B. /api/intake/pending: super_admin (200), attendance_admin (200), attendance_staff (403), finance_admin (403), events_admin (403)
  console.log('  Testing /api/intake/pending:')
  const intakeExpected = {
    super_admin: 200,
    attendance_admin: 200,
    attendance_staff: 403,
    finance_admin: 403,
    events_admin: 403,
  }
  for (const [rName, expStatus] of Object.entries(intakeExpected)) {
    const res = await testFetch('/api/intake/pending', {
      headers: { Authorization: `Bearer ${roles[rName].token}` },
    })
    const pass = res.status === expStatus
    console.log(`    Role: ${rName} -> Status ${res.status} (expected ${expStatus}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleMatrix.push({ route: '/api/intake/pending', role: rName, status: res.status, expected: expStatus, pass })
  }

  // 3C. /api/staff-requests/pending: super_admin ONLY (200), attendance_admin (403), attendance_staff (403), finance_admin (403), events_admin (403)
  console.log('  Testing /api/staff-requests/pending (super_admin ONLY):')
  const staffReqExpected = {
    super_admin: 200,
    attendance_admin: 403,
    attendance_staff: 403,
    finance_admin: 403,
    events_admin: 403,
  }
  for (const [rName, expStatus] of Object.entries(staffReqExpected)) {
    const res = await testFetch('/api/staff-requests/pending', {
      headers: { Authorization: `Bearer ${roles[rName].token}` },
    })
    const pass = res.status === expStatus
    console.log(`    Role: ${rName} -> Status ${res.status} (expected ${expStatus}) [${pass ? 'PASS' : 'FAIL'}]`)
    results.roleMatrix.push({ route: '/api/staff-requests/pending', role: rName, status: res.status, expected: expStatus, pass })
  }

  // -------------------------------------------------------------------------
  // 4. Role = NULL Revocation Verification (Former Pastor & Secretary)
  // -------------------------------------------------------------------------
  console.log('\n4. Verifying Accounts with role = NULL get 403 Forbidden everywhere...')
  const nullAccounts = [
    { label: 'Former Pastor (audit_pastor@test.com)', obj: roles.pastor_now_null },
    { label: 'Former Secretary (audit_secretary@test.com)', obj: roles.secretary_now_null },
  ]
  const protectedRoutes = [
    { name: 'GET /api/dashboard/stats', path: '/api/dashboard/stats', method: 'GET' },
    { name: 'GET /api/intake/pending', path: '/api/intake/pending', method: 'GET' },
    { name: 'GET /api/staff-requests/pending', path: '/api/staff-requests/pending', method: 'GET' },
    { name: 'POST /api/attendance/toggle', path: '/api/attendance/toggle', method: 'POST', body: { serviceId: 'dummy', personId: 'dummy' } },
  ]

  for (const acc of nullAccounts) {
    console.log(`  Account: ${acc.label}`)
    for (const pr of protectedRoutes) {
      const res = await testFetch(pr.path, {
        method: pr.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${acc.obj.token}`,
        },
        body: pr.body ? JSON.stringify(pr.body) : undefined,
      })
      const pass = res.status === 403
      console.log(`    ${pr.name} -> Status ${res.status} (expected 403) [${pass ? 'PASS' : 'FAIL'}]`)
      results.nullRoleRevocation.push({ account: acc.label, route: pr.name, status: res.status, pass })
    }
  }

  // -------------------------------------------------------------------------
  // 5. Section Boundary Enforcement & Cross-Section Admin Exemption
  // -------------------------------------------------------------------------
  console.log('\n5. Testing Attendance Scoping: Section Enforcement vs Admin Cross-Section Exemption...')

  // Find person in Infants section
  const { data: infantsPeople } = await supabaseAdmin
    .from('people')
    .select('id, full_name, section')
    .eq('section', 'Infants')
    .eq('status', 'active')
    .limit(1)

  let infantsPerson = infantsPeople?.[0]
  if (!infantsPerson) {
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

  // 5A. attendance_staff (assigned to Adults & Youth) marks person in Infants -> Expect 403 Forbidden
  const staffCrossSection = await testFetch('/api/attendance/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${roles.attendance_staff.token}`,
    },
    body: JSON.stringify({
      personId: infantsPerson.id,
      serviceId: serviceId,
      isPresent: true,
    }),
  })
  const staffPass = staffCrossSection.status === 403
  console.log(`  attendance_staff (Adults & Youth) marking Infants person -> Status ${staffCrossSection.status} (expected 403) [${staffPass ? 'PASS' : 'FAIL'}]`)
  results.attendanceSectionGate.push({ test: 'attendance_staff cross-section rejection', status: staffCrossSection.status, pass: staffPass })

  // 5B. attendance_admin marks person in Infants -> Expect 200 OK (Cross-section exempt)
  const adminCrossSection = await testFetch('/api/attendance/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${roles.attendance_admin.token}`,
    },
    body: JSON.stringify({
      personId: infantsPerson.id,
      serviceId: serviceId,
      isPresent: true,
    }),
  })
  const adminPass = adminCrossSection.status === 200
  console.log(`  attendance_admin marking cross-section Infants person -> Status ${adminCrossSection.status} (expected 200) [${adminPass ? 'PASS' : 'FAIL'}]`)
  results.attendanceSectionGate.push({ test: 'attendance_admin cross-section exemption', status: adminCrossSection.status, pass: adminPass })

  // -------------------------------------------------------------------------
  // 6. Positions & Units Functionality Verification
  // -------------------------------------------------------------------------
  console.log('\n6. Testing Positions & Units Tag Storage and Searchability...')

  // Create or update a person with distinct positions tags
  const testPersonPhone = '08091122334'
  const targetPositions = ['Pastor', 'Teen Counselor', 'Choir Member']
  
  // Cleanup any old test record
  await supabaseAdmin.from('people').delete().eq('phone', testPersonPhone)

  // Insert person with positions array
  let createdTestPerson
  const { data: posPerson, error: posErr } = await supabaseAdmin
    .from('people')
    .insert({
      full_name: 'Elder Barnabas Test',
      phone: testPersonPhone,
      section: 'Adults & Youth',
      positions: targetPositions,
      status: 'active',
    })
    .select('id, full_name, phone, section, positions')
    .single()

  if (posErr || !posPerson) {
    console.log(`  DB column positions not yet available in DB: ${posErr?.message || 'unknown'}`)
    results.positionsFunctionality.push({ test: 'Positions creation in DB', pass: false, note: 'Migration 010 pending in SQL editor' })
  } else {
    createdTestPerson = posPerson
    const hasPositions = Array.isArray(posPerson.positions) && posPerson.positions.includes('Teen Counselor')
    console.log(`  Positions saved in DB for ${posPerson.full_name}: [${posPerson.positions.join(', ')}] [${hasPositions ? 'PASS' : 'FAIL'}]`)
    results.positionsFunctionality.push({ test: 'Positions saved in DB', pass: hasPositions })

    // Test attendance search by position tag query ("Teen Counselor")
    const searchRes = await testFetch('/api/attendance/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId,
        query: 'Teen Counselor',
      }),
    })
    const matchedMembers = searchRes.body?.people ?? []
    const foundPerson = matchedMembers.find((p) => p.id === createdTestPerson.id)
    const searchPass = Boolean(foundPerson)
    console.log(`  Searching attendance query "Teen Counselor" matches tagged person -> Found: ${Boolean(foundPerson)} [${searchPass ? 'PASS' : 'FAIL'}]`)
    results.positionsFunctionality.push({ test: 'Search attendance by position tag', pass: searchPass })

    // Verify positions do NOT contaminate section
    const sectionIntact = foundPerson?.section === 'Adults & Youth'
    console.log(`  Verify section remains "Adults & Youth" independently: [${sectionIntact ? 'PASS' : 'FAIL'}]`)
    results.positionsFunctionality.push({ test: 'Section separation from positions', pass: sectionIntact })

    // Cleanup
    await supabaseAdmin.from('people').delete().eq('id', createdTestPerson.id)
  }

  // -------------------------------------------------------------------------
  // 7. Cleanup & Summary
  // -------------------------------------------------------------------------
  if (infantsPerson?.full_name === 'Test Infant Audit Person') {
    await supabaseAdmin.from('people').delete().eq('id', infantsPerson.id)
  }

  console.log('\n====================================================================')
  console.log('TWO-TIER AUDIT RUN COMPLETED SUMMARY:')
  const allTests = [
    ...results.unauthenticated,
    ...results.roleMatrix,
    ...results.nullRoleRevocation,
    ...results.attendanceSectionGate,
    ...results.positionsFunctionality,
  ]
  const passedCount = allTests.filter((t) => t.pass).length
  console.log(`Total Tests Executed: ${allTests.length}`)
  console.log(`Passed: ${passedCount}`)
  console.log(`Failed: ${allTests.length - passedCount}`)
  console.log('====================================================================')

  if (allTests.some(t => !t.pass)) {
    console.log('Failing tests detail:', allTests.filter(t => !t.pass))
    process.exit(1)
  }
}

run().catch((e) => {
  console.error('Fatal audit suite error:', e)
  process.exit(1)
})
