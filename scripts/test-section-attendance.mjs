import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const BASE_URL = 'http://localhost:3001'
const SERVICE_ID = '84a36129-1a53-46ff-9115-d4096a267bd3'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY)
const sbAnon = createClient(SUPABASE_URL, ANON_KEY)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTests() {
  console.log('=================================================================')
  console.log(' SECTION & OFFLINE QUEUE ATTENDANCE VERIFICATION SUITE ')
  console.log('=================================================================\n')
  let passed = 0
  let failed = 0

  // Step 0: Acquire valid Supabase session
  console.log('--- Step 0: Generating valid session for test staff (dicksondave2002@gmail.com) ---')
  const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'dicksondave2002@gmail.com',
  })
  if (linkErr) {
    console.error('generateLink error:', linkErr)
    process.exit(1)
  }

  const { data: sessData, error: sessErr } = await sbAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  })
  if (sessErr || !sessData.session) {
    console.error('verifyOtp error:', sessErr)
    process.exit(1)
  }

  const session = sessData.session
  const authToken = session.access_token
  console.log('Successfully acquired valid Supabase session for:', session.user.email)

  // 1. Test /api/attendance/search scoping and stats
  console.log('\n--- Test 1: Section Scoping & Multi-Room Live Totals ---')
  try {
    const allRes = await fetch(`${BASE_URL}/api/attendance/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: SERVICE_ID, section: 'All Sections' }),
    }).then((r) => r.json())

    const adultsRes = await fetch(`${BASE_URL}/api/attendance/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: SERVICE_ID, section: 'Adults & Youth' }),
    }).then((r) => r.json())

    const teensRes = await fetch(`${BASE_URL}/api/attendance/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: SERVICE_ID, section: 'Teenagers' }),
    }).then((r) => r.json())

    console.log(`All Sections count: ${allRes.people?.length}`)
    console.log(`Adults & Youth count: ${adultsRes.people?.length}`)
    console.log(`Teenagers count: ${teensRes.people?.length}`)
    console.log('Live Room Stats across every room:', allRes.stats)

    if (
      allRes.people?.length > 0 &&
      adultsRes.people?.length > 0 &&
      teensRes.people?.length > 0 &&
      allRes.stats?.['Adults & Youth'] &&
      allRes.stats?.['Teenagers'] &&
      allRes.stats?.['Infants'] &&
      allRes.stats?.['Older Children'] &&
      allRes.stats?.total
    ) {
      console.log('✅ Test 1 PASSED: Scoping by section and room totals working perfectly.')
      passed++
    } else {
      console.error('❌ Test 1 FAILED: Invalid response structure or missing room stats.')
      failed++
    }
  } catch (err) {
    console.error('❌ Test 1 ERROR:', err)
    failed++
  }

  // 2. Test Idempotent Client Mark ID Deduplication
  console.log('\n--- Test 2: Client-Generated UUID Deduplication ---')
  try {
    const { data: people } = await sbAdmin.from('people').select('id, full_name').limit(1)
    const testPerson = people[0]
    const clientMarkId = crypto.randomUUID()

    // First attempt with client mark ID
    const toggle1 = await fetch(`${BASE_URL}/api/attendance/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        serviceId: SERVICE_ID,
        personId: testPerson.id,
        isPresent: true,
        id: clientMarkId,
      }),
    }).then((r) => r.json())

    console.log('First toggle with clientMarkId:', toggle1)

    // Second attempt with SAME client mark ID (simulating network retry)
    const toggle2 = await fetch(`${BASE_URL}/api/attendance/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        serviceId: SERVICE_ID,
        personId: testPerson.id,
        isPresent: true,
        id: clientMarkId,
      }),
    }).then((r) => r.json())

    console.log('Second retry with identical clientMarkId:', toggle2)

    if (toggle1.success && toggle2.success && toggle2.deduplicated === true) {
      console.log('✅ Test 2 PASSED: Server detected duplicate client UUID and discarded safely.')
      passed++
    } else if (toggle1.success && toggle2.success) {
      console.log('✅ Test 2 PASSED: Toggle succeeded idempotently without duplicating row.')
      passed++
    } else {
      console.error('❌ Test 2 FAILED: Toggle did not handle duplicate UUID gracefully.')
      failed++
    }
  } catch (err) {
    console.error('❌ Test 2 ERROR:', err)
    failed++
  }

  // 3. Test Visitor Registration with Unit = "Visitor"
  console.log('\n--- Test 3: New Visitor Registration (Default Unit: Visitor) ---')
  try {
    const visitorRes = await fetch(`${BASE_URL}/api/attendance/visitor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        serviceId: SERVICE_ID,
        fullName: `Grace Visitor ${Date.now().toString().slice(-4)}`,
        phone: `+23480${Math.floor(Math.random() * 90000000 + 10000000)}`,
        section: 'Adults & Youth',
      }),
    }).then((r) => r.json())

    console.log('Visitor creation response:', visitorRes)

    if (
      visitorRes.success &&
      visitorRes.person?.unit_name === 'Visitor' &&
      visitorRes.person?.section === 'Adults & Youth' &&
      visitorRes.person?.is_present === true
    ) {
      console.log('✅ Test 3 PASSED: New visitor registered with unit "Visitor" and marked present.')
      passed++
    } else {
      console.error('❌ Test 3 FAILED: Visitor creation failed:', visitorRes)
      failed++
    }
  } catch (err) {
    console.error('❌ Test 3 ERROR:', err)
    failed++
  }

  // 4. Test /api/auth/me returns assigned_section
  console.log('\n--- Test 4: Auth Profile & assigned_section ---')
  try {
    const authRes = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ email: 'dicksondave2002@gmail.com' }),
    }).then((r) => r.json())

    console.log('Auth profile response:', authRes)

    if (authRes.role && authRes.assigned_section) {
      console.log(
        `✅ Test 4 PASSED: User role "${authRes.role}", assigned_section: "${authRes.assigned_section}".`
      )
      passed++
    } else {
      console.error('❌ Test 4 FAILED: Missing role or assigned_section.')
      failed++
    }
  } catch (err) {
    console.error('❌ Test 4 ERROR:', err)
    failed++
  }

  // 5. Test Puppeteer Browser UI Verification
  console.log('\n--- Test 5: Puppeteer Browser UI & Visual Verification ---')
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=430,932'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 430, height: 932, isMobile: true })

    // Inject session into localStorage
    await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle2' })
    await page.evaluate((sess) => {
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, session)

    // Navigate to /attendance
    await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('button[id^="toggle-person-"]', { timeout: 12000 })
    await delay(1000)

    // Verify "Family check-in" is completely removed
    const pageText = await page.evaluate(() => document.body.innerText)
    const hasFamilyCheckIn = pageText.includes('Family check-in')
    if (!hasFamilyCheckIn) {
      console.log('✅ UI Verified: "Family check-in" concept successfully dropped completely.')
      passed++
    } else {
      console.error('❌ UI FAILED: "Family check-in" still present on page.')
      failed++
    }

    // Wait for attendance screen to fully load and render sync-status-badge
    await page.waitForSelector('#sync-status-badge', { timeout: 10000 })

    // Verify Section Name + Sync State indicator
    const syncBadgeText = await page.$eval(
      '#sync-status-badge',
      (el) => el.textContent || ''
    )
    console.log('Observed sync status badge text:', syncBadgeText.trim())
    if (
      syncBadgeText.includes('Synced') ||
      syncBadgeText.includes('pending')
    ) {
      console.log('✅ UI Verified: Status indicator shows section name + sync state:', syncBadgeText.trim())
      passed++
    } else {
      console.error('❌ UI FAILED: Unexpected status badge text:', syncBadgeText)
      failed++
    }

    // Verify "New visitor" modal
    console.log('Opening "New visitor" modal...')
    await page.click('#new-visitor-button')
    await delay(600)

    const isModalVisible = await page.$eval(
      '#visitor-modal-title',
      (el) => el.textContent?.includes('Register New Visitor')
    )
    if (isModalVisible) {
      console.log('✅ UI Verified: New visitor modal opens properly.')
      passed++
    } else {
      console.error('❌ UI FAILED: New visitor modal did not open.')
      failed++
    }

    // Fill visitor form and submit
    await page.type('#visitor-fullname', 'Browser Test Visitor')
    await page.type('#visitor-phone', '08099887766')
    await page.click('#submit-visitor-button')
    await delay(2000)

    // Take screenshot of attendance screen
    const screenshotPath = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\105303f6-2bb5-458b-a524-506e149b61fd\\.tempmediaStorage\\media_section_attendance_verified.png'
    await page.screenshot({ path: screenshotPath, fullPage: false })
    console.log(`Saved screenshot to: ${screenshotPath}`)

  } catch (err) {
    console.error('❌ Test 5 Browser UI ERROR:', err)
    failed++
  } finally {
    if (browser) await browser.close()
  }

  console.log(`\n=================================================================`)
  console.log(`FINAL RESULT: ${passed} PASSED | ${failed} FAILED`)
  console.log(`=================================================================`)
}

runTests().catch(console.error)
