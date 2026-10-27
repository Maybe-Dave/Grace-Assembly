import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE_URL = 'http://localhost:3000'
const OUT_DIR = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\16514a6b-e0ac-4208-a988-0adac23168d8\\screenshots'

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getSessionFor(email) {
  const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const { data: sessData } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  })
  return sessData.session
}

async function capture() {
  console.log('Starting screenshot captures...')
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })

  // 1. Sign-in screen (clean / public)
  console.log('1. Capturing Sign-in screen...')
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
  await delay(1000)
  await page.screenshot({ path: path.join(OUT_DIR, '01_signin_screen.png') })

  // 2. Staff-request form (empty)
  console.log('2. Capturing /staff-request empty form...')
  await page.goto(`${BASE_URL}/staff-request`, { waitUntil: 'networkidle2' })
  await delay(1000)
  await page.screenshot({ path: path.join(OUT_DIR, '02_staff_request_empty.png') })

  // 2b. Staff-request form (submitted confirmation)
  console.log('2b. Submitting a test staff request...')
  await page.type('#full-name-input', 'Sister Grace Audit')
  await page.type('#email-input', 'grace.audit@example.com')
  await page.type('#phone-input', '08099887766')
  await page.click('#submit-staff-request-button')
  await delay(2000)
  await page.screenshot({ path: path.join(OUT_DIR, '02b_staff_request_submitted.png') })

  // 3. Setup sessions for role-gated screens
  const usherSession = await getSessionFor('audit_usher@test.com')
  const headUsherSession = await getSessionFor('audit_head_usher@test.com')
  const pastorSession = await getSessionFor('audit_pastor@test.com')
  const adminSession = await getSessionFor('audit_admin@test.com')

  // Helper to inject session into localStorage
  async function setSession(sess) {
    await page.evaluate((s) => {
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(s))
    }, sess)
  }

  // 4. /attendance (usher)
  console.log('3. Capturing /attendance screens...')
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
  await setSession(usherSession)
  await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
  await delay(2000)
  await page.screenshot({ path: path.join(OUT_DIR, '03_attendance_synced.png') })

  // 4b. /attendance searching state
  const searchInput = await page.$('input[placeholder*="Search"]')
  if (searchInput) {
    await searchInput.type('Brother')
    await delay(600)
    await page.screenshot({ path: path.join(OUT_DIR, '03b_attendance_searching.png') })
    await searchInput.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
  }

  // 5. /intake form (empty & duplicate warning)
  console.log('4. Capturing /intake screens...')
  await page.goto(`${BASE_URL}/intake`, { waitUntil: 'networkidle2' })
  await delay(1500)
  await page.screenshot({ path: path.join(OUT_DIR, '04_intake_empty.png') })

  // Type an existing member phone to show duplicate warning
  const phoneInput = await page.$('input[type="tel"]')
  if (phoneInput) {
    await phoneInput.type('08000000001')
    await delay(1500)
    await page.screenshot({ path: path.join(OUT_DIR, '04b_intake_duplicate_warning.png') })
  }

  // 6. /approvals (Head Usher)
  console.log('5. Capturing /approvals...')
  await setSession(headUsherSession)
  await page.goto(`${BASE_URL}/approvals`, { waitUntil: 'networkidle2' })
  await delay(2000)
  await page.screenshot({ path: path.join(OUT_DIR, '05_approvals_head_usher.png') })

  // 7. /staff-approvals (Pastor / Secretary)
  console.log('6. Capturing /staff-approvals...')
  await setSession(pastorSession)
  await page.goto(`${BASE_URL}/staff-approvals`, { waitUntil: 'networkidle2' })
  await delay(2000)
  await page.screenshot({ path: path.join(OUT_DIR, '06_staff_approvals_pastor.png') })

  // 8. /dashboard (Admin/Pastor - Live tab & Historical tab)
  console.log('7. Capturing /dashboard...')
  await setSession(adminSession)
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' })
  await delay(2500)
  await page.screenshot({ path: path.join(OUT_DIR, '07_dashboard_live_tab.png') })

  // Click Historical tab if exists
  const histTab = await page.$('#tab-history')
  if (histTab) {
    await histTab.click()
    await delay(1500)
    await page.screenshot({ path: path.join(OUT_DIR, '07b_dashboard_historical_tab.png') })
  }

  // 9. 403 Forbidden screen (Usher navigating to /dashboard)
  console.log('8. Capturing 403 Forbidden screen...')
  await setSession(usherSession)
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' })
  await delay(1500)
  await page.screenshot({ path: path.join(OUT_DIR, '08_dashboard_403_forbidden.png') })

  await browser.close()
  console.log('All screenshots captured successfully!')
}

capture().catch((err) => {
  console.error('Screenshot error:', err)
  process.exit(1)
})
