import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:3001'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ARTIFACTS_DIR = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\105303f6-2bb5-458b-a524-506e149b61fd'
const MEDIA_DIR = path.join(ARTIFACTS_DIR, '.tempmediaStorage')

function log(step, msg) {
  console.log(`[${step}] ${msg}`)
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function run() {
  console.log('================================================================')
  console.log('   GRACE ASSEMBLY — STAFF ACCOUNT CREATION & APPROVAL FLOW TEST')
  console.log('================================================================\n')

  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true })
  }

  // -------------------------------------------------------------------------
  // STEP 1: SUBMIT A STAFF ACCESS REQUEST
  // -------------------------------------------------------------------------
  log('STEP 1', 'Submitting new staff access request for volunteer usher...')
  const uniqueId = Date.now().toString().slice(-5)
  const candidateEmail = `volunteer.usher_${uniqueId}@graceassembly.test`
  const candidateName = `Brother Emmanuel Test_${uniqueId}`
  const candidatePhone = `0803${Math.floor(1000000 + Math.random() * 9000000)}`
  const requestedRole = 'usher'
  const requestedSection = 'Infants'

  const submitRes = await fetch(`${BASE_URL}/api/staff-requests/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: candidateName,
      email: candidateEmail,
      phone: candidatePhone,
      requestedRole,
      requestedSection,
    }),
  })

  const submitData = await submitRes.json()
  if (!submitRes.ok || !submitData.success) {
    throw new Error(`Failed to submit staff request: ${JSON.stringify(submitData)}`)
  }
  const requestId = submitData.requestId
  log('STEP 1 PASS', `Request submitted successfully! ID: ${requestId}, Storage: ${submitData.storage}`)

  // -------------------------------------------------------------------------
  // STEP 2: VERIFY REQUESTER CANNOT SIGN IN YET (NO ACCESS GRANTED)
  // -------------------------------------------------------------------------
  log('STEP 2', 'Verifying requester does NOT have staff access yet...')
  const checkStaffRes = await fetch(`${BASE_URL}/api/auth/check-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: candidateEmail }),
  })
  const checkStaffData = await checkStaffRes.json()

  if (checkStaffData.isStaff === true) {
    throw new Error('SECURITY VIOLATION: Requester was granted staff access before approval!')
  }
  log('STEP 2 PASS', `Verified: check-staff returns isStaff=false ("${checkStaffData.error}")`)

  // -------------------------------------------------------------------------
  // STEP 3: TEST EDGE CASES (DUPLICATE PENDING & FORBIDDEN ROLES)
  // -------------------------------------------------------------------------
  log('STEP 3A', 'Testing duplicate submission prevention while pending...')
  const dupSubmitRes = await fetch(`${BASE_URL}/api/staff-requests/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: candidateName,
      email: candidateEmail,
      phone: candidatePhone,
      requestedRole: 'usher',
      requestedSection: 'Infants',
    }),
  })
  if (dupSubmitRes.status !== 409) {
    throw new Error(`Expected 409 Conflict for duplicate pending request, got ${dupSubmitRes.status}`)
  }
  log('STEP 3A PASS', 'Duplicate pending submission correctly rejected with 409 Conflict.')

  log('STEP 3B', 'Testing server rejection of self-selecting Admin/Pastor/Secretary on request...')
  const badRoleRes = await fetch(`${BASE_URL}/api/staff-requests/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Hacker Attempt',
      email: `hacker_${uniqueId}@test.com`,
      phone: '08000000000',
      requestedRole: 'admin',
      requestedSection: 'Adults & Youth',
    }),
  })
  if (badRoleRes.status !== 400) {
    throw new Error(`Expected 400 Bad Request for requesting admin role, got ${badRoleRes.status}`)
  }
  log('STEP 3B PASS', 'Self-selecting admin/pastor/secretary correctly rejected with 400.')

  // -------------------------------------------------------------------------
  // STEP 4: STRICT ROLE GATING ON /staff-approvals
  // -------------------------------------------------------------------------
  log('STEP 4', 'Verifying /staff-approvals permission gates strictly to Pastor & Secretary...')

  // A. Usher session -> must get 403
  const usherDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'usher', section: 'Adults & Youth' }),
  })
  const usherDevData = await usherDevRes.json()
  const usherSession = usherDevData?.session
  const usherToken = usherSession?.access_token

  const usherGateRes = await fetch(`${BASE_URL}/api/staff-requests/pending`, {
    headers: { Authorization: `Bearer ${usherToken}` },
  })
  if (usherGateRes.status !== 403) {
    throw new Error(`Expected 403 for Usher on staff approvals, got ${usherGateRes.status}`)
  }
  log('STEP 4A PASS', 'Usher correctly received 403 Forbidden.')

  // B. Head Usher session -> must get 403
  const headUsherDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'head_usher', section: 'Adults & Youth' }),
  })
  const headUsherToken = (await headUsherDevRes.json())?.session?.access_token

  const headUsherGateRes = await fetch(`${BASE_URL}/api/staff-requests/pending`, {
    headers: { Authorization: `Bearer ${headUsherToken}` },
  })
  if (headUsherGateRes.status !== 403) {
    throw new Error(`Expected 403 for Head Usher on staff approvals, got ${headUsherGateRes.status}`)
  }
  log('STEP 4B PASS', 'Head Usher correctly received 403 Forbidden.')

  // C. Admin session -> must get 403 (per explicit requirement: separate from /dashboard)
  const adminDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin', section: 'Adults & Youth' }),
  })
  const adminToken = (await adminDevRes.json())?.session?.access_token

  const adminGateRes = await fetch(`${BASE_URL}/api/staff-requests/pending`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (adminGateRes.status !== 403) {
    throw new Error(`Expected 403 for Admin on staff approvals, got ${adminGateRes.status}`)
  }
  log('STEP 4C PASS', 'Admin correctly received 403 Forbidden.')

  // D. Pastor session -> must get 200
  const pastorDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'pastor', section: 'Adults & Youth' }),
  })
  const pastorDevData = await pastorDevRes.json()
  const pastorSession = pastorDevData?.session
  const pastorToken = pastorSession?.access_token

  const pastorGateRes = await fetch(`${BASE_URL}/api/staff-requests/pending`, {
    headers: { Authorization: `Bearer ${pastorToken}` },
  })
  if (pastorGateRes.status !== 200) {
    throw new Error(`Expected 200 for Pastor on staff approvals, got ${pastorGateRes.status}`)
  }
  const pastorData = await pastorGateRes.json()
  log('STEP 4D PASS', `Pastor received 200 OK (${pastorData.requests?.length} pending requests found).`)

  // E. Secretary session -> must get 200
  const secretaryDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'secretary', section: 'Adults & Youth' }),
  })
  const secretaryToken = (await secretaryDevRes.json())?.session?.access_token

  const secretaryGateRes = await fetch(`${BASE_URL}/api/staff-requests/pending`, {
    headers: { Authorization: `Bearer ${secretaryToken}` },
  })
  if (secretaryGateRes.status !== 200) {
    throw new Error(`Expected 200 for Secretary on staff approvals, got ${secretaryGateRes.status}`)
  }
  log('STEP 4E PASS', 'Secretary received 200 OK.')

  // -------------------------------------------------------------------------
  // STEP 5: TEST SERVER-SIDE CONSTRAINT ON APPROVAL ACTION
  // -------------------------------------------------------------------------
  log('STEP 5', 'Testing server rejection if approval attempts to grant Admin/Pastor/Secretary...')
  const badApprovalRes = await fetch(`${BASE_URL}/api/staff-requests/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pastorToken}`,
    },
    body: JSON.stringify({
      requestId,
      action: 'approve',
      approvedRole: 'admin',
      approvedSection: 'Adults & Youth',
    }),
  })
  if (badApprovalRes.status !== 400) {
    throw new Error(`Expected 400 Bad Request for approving as admin, got ${badApprovalRes.status}`)
  }
  log('STEP 5 PASS', 'Server correctly rejected attempt to approve as Admin.')

  // -------------------------------------------------------------------------
  // STEP 6: APPROVE THE REQUEST (PASTOR/SECRETARY)
  // -------------------------------------------------------------------------
  log('STEP 6', 'Approving staff request as Pastor...')
  const approveRes = await fetch(`${BASE_URL}/api/staff-requests/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pastorToken}`,
    },
    body: JSON.stringify({
      requestId,
      action: 'approve',
      approvedRole: 'usher',
      approvedSection: requestedSection,
    }),
  })
  const approveData = await approveRes.json()
  if (!approveRes.ok || !approveData.success) {
    throw new Error(`Failed to approve staff request: ${JSON.stringify(approveData)}`)
  }
  log('STEP 6 PASS', `Approved! Message: "${approveData.message}" (activationTriggered=${approveData.activationTriggered})`)

  // -------------------------------------------------------------------------
  // STEP 7: CONFIRM NEW STAFF MEMBER CAN NOW SIGN IN & GETS SCOPED
  // -------------------------------------------------------------------------
  log('STEP 7', 'Verifying newly approved usher is recognized by sign-in flow...')
  const afterCheckStaffRes = await fetch(`${BASE_URL}/api/auth/check-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: candidateEmail }),
  })
  const afterCheckStaffData = await afterCheckStaffRes.json()
  if (!afterCheckStaffData.isStaff) {
    throw new Error(`Expected candidate to be registered as staff, got: ${JSON.stringify(afterCheckStaffData)}`)
  }
  log('STEP 7A PASS', `Candidate verified as staff: name=${afterCheckStaffData.name}, role=${afterCheckStaffData.role}`)

  // Confirm /api/auth/me returns proper role & assigned_section
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: candidateEmail }),
  })
  const meData = await meRes.json()
  if (meData.role !== 'usher' || meData.assigned_section !== requestedSection) {
    throw new Error(`Profile mismatch: expected role=usher & section=${requestedSection}, got role=${meData.role} & section=${meData.assigned_section}`)
  }
  log('STEP 7B PASS', `Profile correctly scoped: role=${meData.role}, assigned_section=${meData.assigned_section}`)

  // Confirms duplicate submission with approved email is rejected
  const dupApprovedRes = await fetch(`${BASE_URL}/api/staff-requests/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: candidateName,
      email: candidateEmail,
      phone: candidatePhone,
      requestedRole: 'usher',
      requestedSection: 'Infants',
    }),
  })
  if (dupApprovedRes.status !== 409) {
    throw new Error(`Expected 409 Conflict for already approved staff email, got ${dupApprovedRes.status}`)
  }
  log('STEP 7C PASS', 'Duplicate request for already-approved staff email correctly rejected with 409.')

  // -------------------------------------------------------------------------
  // STEP 8: PUPPETEER BROWSER VERIFICATION & SCREENSHOT CAPTURE
  // -------------------------------------------------------------------------
  log('STEP 8', 'Launching Puppeteer Chrome for visual validation & evidence capture...')
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 850 })

  const timestamp = Date.now()

  // 1. Sign-in screen with Request Staff Access entry
  log('BROWSER', 'Capturing welcome screen with Request Staff Access entry...')
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' })
  await delay(600)
  const screenshot1 = path.join(MEDIA_DIR, `staff_entry_point_${timestamp}.png`)
  await page.screenshot({ path: screenshot1, fullPage: true })
  log('BROWSER', `Saved: ${screenshot1}`)

  // 2. Staff Request Page
  log('BROWSER', 'Navigating to /staff-request...')
  await page.goto(`${BASE_URL}/staff-request`, { waitUntil: 'networkidle0' })
  await delay(600)
  const screenshot2 = path.join(MEDIA_DIR, `staff_request_form_${timestamp}.png`)
  await page.screenshot({ path: screenshot2, fullPage: true })
  log('BROWSER', `Saved: ${screenshot2}`)

  // 3. 403 Forbidden Screen on /staff-approvals for Usher
  log('BROWSER', 'Setting Usher session and accessing /staff-approvals (verifying 403 UI)...')
  await page.goto(
    `${BASE_URL}/api/auth/dev-login?redirect=true&role=usher&redirectPath=/staff-approvals`,
    { waitUntil: 'networkidle0' }
  )
  await delay(2000)
  const currentUrl = page.url()
  log('DEBUG', `Current URL after dev-login: ${currentUrl}`)
  const debugShot = path.join(MEDIA_DIR, `debug_usher_${timestamp}.png`)
  await page.screenshot({ path: debugShot, fullPage: true })
  log('DEBUG', `Saved debug screenshot: ${debugShot}`)

  await page.waitForSelector('#staff-approvals-403-card', { timeout: 10000 })
  await delay(600)
  const screenshot3 = path.join(MEDIA_DIR, `staff_approvals_403_usher_${timestamp}.png`)
  await page.screenshot({ path: screenshot3, fullPage: true })
  log('BROWSER', `Saved 403 Screenshot: ${screenshot3}`)

  // 4. Pastor Approval Screen with pending queue
  log('BROWSER', 'Setting Pastor session and accessing /staff-approvals (verifying 200 UI)...')
  // Submit a fresh pending request so pastor sees it in the list
  const newCandidateEmail = `new.volunteer_${timestamp}@graceassembly.test`
  await fetch(`${BASE_URL}/api/staff-requests/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: `Sister Deborah Test_${uniqueId}`,
      email: newCandidateEmail,
      phone: '08023456789',
      requestedRole: 'head_usher',
      requestedSection: 'Teenagers',
    }),
  })

  await page.goto(
    `${BASE_URL}/api/auth/dev-login?redirect=true&role=pastor&redirectPath=/staff-approvals`,
    { waitUntil: 'networkidle0' }
  )
  await page.waitForSelector('h1', { timeout: 10000 })
  await delay(800)
  const screenshot4 = path.join(MEDIA_DIR, `staff_approvals_pastor_view_${timestamp}.png`)
  await page.screenshot({ path: screenshot4, fullPage: true })
  log('BROWSER', `Saved Pastor View Screenshot: ${screenshot4}`)

  await browser.close()

  console.log('\n================================================================')
  console.log('   ALL TESTS PASSED! Staff account onboarding & approval flow')
  console.log('   is fully implemented, gated, and verified.')
  console.log('================================================================\n')
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err)
  process.exit(1)
})
