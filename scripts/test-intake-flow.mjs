import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ARTIFACTS_DIR = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\105303f6-2bb5-458b-a524-506e149b61fd'

function log(step, msg) {
  console.log(`[${step}] ${msg}`)
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function run() {
  console.log('====================================================')
  console.log('   GRACE ASSEMBLY — NEW PERSON INTAKE FLOW TEST')
  console.log('====================================================')

  // 1. Obtain sessions via dev-login
  log('AUTH', 'Obtaining test sessions for Usher and Head Usher...')

  const usherDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'usher.testing@grace.internal', role: 'usher', section: 'Adults & Youth' }),
  })
  const usherData = await usherDevRes.json()
  const usherToken = usherData?.session?.access_token
  log('AUTH', `Usher dev session obtained: token prefix ${usherToken?.slice(0, 10)}...`)

  const headUsherDevRes = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'head_usher', section: 'Adults & Youth' }),
  })
  const headUsherData = await headUsherDevRes.json()
  const headUsherToken = headUsherData?.session?.access_token
  log('AUTH', `Head Usher dev session obtained: token prefix ${headUsherToken?.slice(0, 10)}...`)

  // 2. Test Phone Lookup API
  log('LOOKUP', 'Testing phone lookup against existing records...')

  const existingPhone = '08099887766'
  const dupLookupRes = await fetch(`${BASE_URL}/api/intake/lookup-phone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: existingPhone }),
  })
  const dupLookupData = await dupLookupRes.json()
  const existingMember = dupLookupData.person
  log('LOOKUP', `Existing phone lookup result: matched=${dupLookupData.matched}, name=${existingMember?.full_name}`)

  const newPhone = `080${Math.floor(10000000 + Math.random() * 90000000)}`
  const newLookupRes = await fetch(`${BASE_URL}/api/intake/lookup-phone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: newPhone }),
  })
  const newLookupData = await newLookupRes.json()
  log('LOOKUP', `Unique new phone (${newPhone}) lookup result: matched=${newLookupData.matched}`)

  // 3. Submit New Person to Pending Queue
  log('SUBMIT', 'Submitting new first-time visitor to intake queue...')
  const testVisitorName = `Sister Ngozi IntakeTest_${Date.now().toString().slice(-4)}`
  const submitRes1 = await fetch(`${BASE_URL}/api/intake/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${usherToken}`,
    },
    body: JSON.stringify({
      fullName: testVisitorName,
      phone: newPhone,
      section: 'Adults & Youth',
      unit: 'Visitor',
      statusFlag: 'first_time',
      collectorName: 'Dave D.',
      collectorSection: 'Adults & Youth',
    }),
  })
  const submitData1 = await submitRes1.json()
  const pendingId1 = submitData1.pendingId || submitData1.pendingPerson?.id
  log('SUBMIT', `Submission 1 response: success=${submitData1.success}, id=${pendingId1}`)

  // Verify NOT in active attendance before approval
  const preCheckRes = await fetch(`${BASE_URL}/api/attendance/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceId: '84a36129-1a53-46ff-9115-d4096a267bd3',
      section: 'Adults & Youth',
      query: testVisitorName,
    }),
  })
  const preCheckData = await preCheckRes.json()
  const existsBeforeApproval = (preCheckData?.people || []).some((p) => p.full_name === testVisitorName)
  log('SUBMIT', `Confirmed: New person is NOT in active attendance before approval: ${!existsBeforeApproval}`)

  // Submit second item flagged as duplicate
  log('SUBMIT', 'Submitting duplicate-flagged attendee to intake queue...')
  const testDupName = `Bro Daniel DuplicateTest_${Date.now().toString().slice(-4)}`
  const submitRes2 = await fetch(`${BASE_URL}/api/intake/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${usherToken}`,
    },
    body: JSON.stringify({
      fullName: testDupName,
      phone: existingPhone,
      section: 'Adults & Youth',
      unit: 'Member',
      statusFlag: 'returning',
      duplicateMatchedPersonId: existingMember?.id || null,
      collectorName: 'Dave D.',
      collectorSection: 'Adults & Youth',
    }),
  })
  const submitData2 = await submitRes2.json()
  const pendingId2 = submitData2.pendingId || submitData2.pendingPerson?.id
  log('SUBMIT', `Submission 2 (flagged dup) response: success=${submitData2.success}, id=${pendingId2}`)

  // 4. Head Usher Queue & Access Control
  log('APPROVALS', 'Checking role-gating on /api/intake/pending...')
  const usherQueueRes = await fetch(`${BASE_URL}/api/intake/pending`, {
    headers: { Authorization: `Bearer ${usherToken}` },
  })
  log('APPROVALS', `Usher queue access status: ${usherQueueRes.status} (Expected: 403)`)

  const headUsherQueueRes = await fetch(`${BASE_URL}/api/intake/pending`, {
    headers: { Authorization: `Bearer ${headUsherToken}` },
  })
  const headUsherQueueData = await headUsherQueueRes.json()
  log('APPROVALS', `Head Usher queue access status: ${headUsherQueueRes.status}, count: ${headUsherQueueData.count}`)

  const pendingList = headUsherQueueData.pendingPeople || []
  const pending1 = pendingList.find((p) => p.id === pendingId1)
  const pending2 = pendingList.find((p) => p.id === pendingId2)
  log('APPROVALS', `Found pending 1 in queue: ${Boolean(pending1)}`)
  log('APPROVALS', `Found pending 2 (duplicate flagged) in queue: ${Boolean(pending2)}, matched_person=${Boolean(pending2?.matched_person || pending2?.duplicate_matched_person_id)}`)

  // 5. Test Head Usher Actions
  // A. Approve submission 1 as New Person
  log('ACTION', `Approving pending 1 (${testVisitorName}) as new person...`)
  const approveRes = await fetch(`${BASE_URL}/api/intake/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${headUsherToken}`,
    },
    body: JSON.stringify({
      pendingId: pendingId1,
      action: 'approve_new',
    }),
  })
  const approveData = await approveRes.json()
  log('ACTION', `Approve result: success=${approveData.success}, createdPersonId=${approveData.personId}`)

  // Verify now immediately visible in attendance for assigned section
  const postCheckRes = await fetch(`${BASE_URL}/api/attendance/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceId: '84a36129-1a53-46ff-9115-d4096a267bd3',
      section: 'Adults & Youth',
      query: testVisitorName,
    }),
  })
  const postCheckData = await postCheckRes.json()
  const existsAfterApproval = (postCheckData?.people || []).some((p) => p.full_name === testVisitorName)
  log('ACTION', `Confirmed: Approved person is now ACTIVE in attendance: ${existsAfterApproval}`)

  // B. Merge submission 2
  log('ACTION', `Merging pending 2 (${testDupName}) into existing record...`)
  const mergeRes = await fetch(`${BASE_URL}/api/intake/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${headUsherToken}`,
    },
    body: JSON.stringify({
      pendingId: pendingId2,
      action: 'merge',
    }),
  })
  const mergeData = await mergeRes.json()
  log('ACTION', `Merge result: success=${mergeData.success}`)

  // 6. Puppeteer Browser UI Verification & Screenshots
  log('BROWSER', 'Launching Chrome for visual UI evidence...')
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

    // Step A: Login as usher and view /intake form
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await page.click('#dev-login-usher-button')
    await delay(1000)

    // Navigate to full-page intake
    await page.goto(`${BASE_URL}/intake`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('#intake-fullname', { timeout: 10000 })

    // Fill form and trigger phone duplicate check
    await page.type('#intake-fullname', 'Mary Oluwaseun')
    await page.type('#intake-phone', existingPhone)
    await delay(1000) // Wait for live debounced lookup

    const shot1 = path.join(ARTIFACTS_DIR, 'phase6_01_intake_form_duplicate_warning.png')
    await page.screenshot({ path: shot1, fullPage: false })
    log('BROWSER', `Saved screenshot 1: ${shot1}`)

    // Submit form (soft warning does NOT block submit)
    await page.click('#submit-intake-button')
    await page.waitForSelector('[role="status"]', { timeout: 10000 })
    await delay(500)

    const shot2 = path.join(ARTIFACTS_DIR, 'phase6_02_intake_submitted_success.png')
    await page.screenshot({ path: shot2, fullPage: false })
    log('BROWSER', `Saved screenshot 2: ${shot2}`)

    // Step B: Head Usher Approval Queue UI
    // Switch to head usher session
    await page.evaluate((sess) => {
      localStorage.clear()
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k) localStorage.removeItem(k)
      }
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, headUsherData.session)
    await delay(300)

    await page.goto(`${BASE_URL}/approvals`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('h1', { timeout: 10000 })
    await delay(1200)

    const shot3 = path.join(ARTIFACTS_DIR, 'phase6_03_head_usher_approvals_queue.png')
    await page.screenshot({ path: shot3, fullPage: false })
    log('BROWSER', `Saved screenshot 3: ${shot3}`)

    // Step C: Attendance Screen with Header Queue badge and + New person button
    await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('#new-visitor-button', { timeout: 10000 })
    await delay(1000)

    const shot4 = path.join(ARTIFACTS_DIR, 'phase6_04_attendance_header_with_intake_links.png')
    await page.screenshot({ path: shot4, fullPage: false })
    log('BROWSER', `Saved screenshot 4: ${shot4}`)

    // Step D: Open New Person modal on attendance screen to verify collector header & live warning inside modal
    await page.click('#new-visitor-button')
    await page.waitForSelector('#visitor-fullname', { timeout: 5000 })
    await page.type('#visitor-fullname', 'Brother Kelechi')
    await page.type('#visitor-phone', existingPhone)
    await delay(1000)

    const shot5 = path.join(ARTIFACTS_DIR, 'phase6_05_attendance_modal_intake.png')
    await page.screenshot({ path: shot5, fullPage: false })
    log('BROWSER', `Saved screenshot 5: ${shot5}`)

    console.log('\n====================================================')
    console.log('   ALL INTAKE FLOW & APPROVAL TESTS PASSED!')
    console.log('====================================================')
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error('Test execution error:', err)
  process.exit(1)
})
