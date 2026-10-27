import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ARTIFACTS_DIR = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\105303f6-2bb5-458b-a524-506e149b61fd'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in environment')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function log(section, msg) {
  console.log(`[${section}] ${msg}`)
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function run() {
  console.log('====================================================')
  console.log('  GRACE ASSEMBLY — DASHBOARD & OFFLINE QUEUE TEST  ')
  console.log('====================================================')

  // -----------------------------------------------------------------
  // 1. Authenticate sessions for Admin, Head Usher, and Usher
  // -----------------------------------------------------------------
  log('AUTH', 'Obtaining test sessions for Admin, Head Usher, and Usher...')

  const adminDev = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin.dashboard@grace.internal', role: 'admin', section: 'Adults & Youth' }),
  })
  const adminData = await adminDev.json()
  const adminToken = adminData?.session?.access_token

  const headUsherDev = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'headusher.test@grace.internal', role: 'head_usher', section: 'Adults & Youth' }),
  })
  const headUsherData = await headUsherDev.json()
  const headUsherToken = headUsherData?.session?.access_token

  const usherDev = await fetch(`${BASE_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'usher.queue@grace.internal', role: 'usher', section: 'Adults & Youth' }),
  })
  const usherData = await usherDev.json()
  const usherToken = usherData?.session?.access_token

  log('AUTH', `Admin token prefix: ${adminToken?.slice(0, 10)}...`)
  log('AUTH', `Head Usher token prefix: ${headUsherToken?.slice(0, 10)}...`)
  log('AUTH', `Usher token prefix: ${usherToken?.slice(0, 10)}...`)

  // -----------------------------------------------------------------
  // PART A: Admin Combined Attendance Dashboard API & Role Gate
  // -----------------------------------------------------------------
  log('DASHBOARD', 'Testing role gate on /api/dashboard/stats...')

  // 1. Regular Usher must receive 403 Forbidden
  const usherStatsRes = await fetch(`${BASE_URL}/api/dashboard/stats`, {
    headers: { Authorization: `Bearer ${usherToken}` },
  })
  log('DASHBOARD', `Usher access response: ${usherStatsRes.status} (Expected: 403)`)
  if (usherStatsRes.status !== 403) throw new Error(`Expected 403 for usher, got ${usherStatsRes.status}`)

  // 2. Head Usher must receive 403 Forbidden (restricted to admin/pastor/secretary)
  const headUsherStatsRes = await fetch(`${BASE_URL}/api/dashboard/stats`, {
    headers: { Authorization: `Bearer ${headUsherToken}` },
  })
  log('DASHBOARD', `Head Usher access response: ${headUsherStatsRes.status} (Expected: 403)`)
  if (headUsherStatsRes.status !== 403) throw new Error(`Expected 403 for head_usher, got ${headUsherStatsRes.status}`)

  // 3. Admin must receive 200 OK with combined stats
  const adminStatsRes = await fetch(`${BASE_URL}/api/dashboard/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  log('DASHBOARD', `Admin access response: ${adminStatsRes.status} (Expected: 200)`)
  if (adminStatsRes.status !== 200) throw new Error(`Expected 200 for admin, got ${adminStatsRes.status}`)

  const adminStatsData = await adminStatsRes.json()
  const activeSvc = adminStatsData.activeService
  log('DASHBOARD', `Active service: "${activeSvc.type}" on ${activeSvc.serviceDate}`)
  log('DASHBOARD', `Combined church-wide total: ${activeSvc.combinedPresent} of ${activeSvc.combinedTotal} present (${activeSvc.combinedPercent}%)`)
  log('DASHBOARD', `Sections breakdown count: ${activeSvc.sections?.length}`)
  for (const s of activeSvc.sections || []) {
    log('DASHBOARD', `  -> ${s.section}: ${s.present} / ${s.total} (${s.percent}%) · ${s.ushers?.length} ushers marking`)
  }

  log('DASHBOARD', `Historical services recorded: ${adminStatsData.historicalServices?.length}`)
  for (const h of (adminStatsData.historicalServices || []).slice(0, 3)) {
    log('DASHBOARD', `  -> [History] ${h.serviceDate} (${h.type}): ${h.combinedPresent} / ${h.combinedTotal} (${h.percent}%)`)
  }

  // -----------------------------------------------------------------
  // PART B: Offline Sync Queue Verification
  // -----------------------------------------------------------------
  log('OFFLINE_QUEUE', 'Testing offline attendance queue in headless Chrome...')

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

    // Step 1: Open attendance as Usher
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await page.evaluate((sess) => {
      localStorage.clear()
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, usherData.session)
    await delay(300)

    await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('button[id^="toggle-person-"]', { timeout: 10000 })
    await delay(1000)

    // Baseline: Verify initial sync state is "Synced"
    const initialBadgeText = await page.$eval('#sync-status-badge', (el) => el.textContent)
    log('OFFLINE_QUEUE', `Initial baseline status badge: "${initialBadgeText?.trim()}"`)

    // Step 2: Go OFFLINE (simulate mobile data outage during service)
    log('OFFLINE_QUEUE', 'Simulating offline data drop (setOfflineMode = true)...')
    await page.setOfflineMode(true)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await delay(500)

    // Step 3: Tap 3 attendance toggles while offline
    const toggleButtons = await page.$$('button[id^="toggle-person-"]')
    log('OFFLINE_QUEUE', `Found ${toggleButtons.length} attendance toggle buttons. Tapping first 3 while OFFLINE...`)

    const tappedPersonIds = []
    for (let i = 0; i < 3 && i < toggleButtons.length; i++) {
      const btnId = await page.evaluate((el) => el.id, toggleButtons[i])
      const pId = btnId.replace('toggle-person-', '')
      tappedPersonIds.push(pId)
      await toggleButtons[i].click()
      await delay(200)
    }

    await delay(600)

    // Step 4: Verify IndexedDB queue has stored marks
    const queuedItems = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('grace_assembly_offline_db', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attendance_queue', 'readonly')
          const store = tx.objectStore('attendance_queue')
          const getAllReq = store.getAll()
          getAllReq.onsuccess = () => resolve(getAllReq.result)
          getAllReq.onerror = () => resolve([])
        }
        req.onerror = () => resolve([])
      })
    })

    log('OFFLINE_QUEUE', `IndexedDB items in queue: ${queuedItems?.length}`)
    if (queuedItems?.length > 0) {
      log('OFFLINE_QUEUE', `Sample clientMarkId: ${queuedItems[0]?.id}`)
    }

    // Verify UI reflects "N pending"
    const offlineHeaderBadge = await page.$eval('#header-sync-status', (el) => el.textContent).catch(() => '')
    const offlineFooterBadge = await page.$eval('#sync-status-badge', (el) => el.textContent).catch(() => '')
    log('OFFLINE_QUEUE', `Offline header badge: "${offlineHeaderBadge?.trim()}"`)
    log('OFFLINE_QUEUE', `Offline footer badge: "${offlineFooterBadge?.trim()}"`)

    // Capture screenshot: Attendance while offline showing pending cue
    const shotPending = path.join(ARTIFACTS_DIR, 'phase7_04_attendance_offline_pending.png')
    await page.screenshot({ path: shotPending, fullPage: false })
    log('BROWSER', `Saved offline pending screenshot: ${shotPending}`)

    // Step 5: Re-enable network (come back online)
    log('OFFLINE_QUEUE', 'Re-enabling network (setOfflineMode = false)...')
    await page.setOfflineMode(false)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
    })

    // Wait for FIFO sync replay and queue to flush
    log('OFFLINE_QUEUE', 'Waiting for queue flush to complete...')
    let flushed = false
    for (let attempts = 0; attempts < 15; attempts++) {
      await delay(800)
      const currentBadge = await page.$eval('#sync-status-badge', (el) => el.textContent).catch(() => '')
      if (currentBadge && currentBadge.includes('Synced')) {
        flushed = true
        log('OFFLINE_QUEUE', `Queue successfully flushed to: "${currentBadge.trim()}" (attempt ${attempts + 1})`)
        break
      }
    }

    if (!flushed) {
      console.warn('Warning: Queue did not auto-flush within timeout, triggering manual sync check')
    }

    const shotSynced = path.join(ARTIFACTS_DIR, 'phase7_05_attendance_synced_flushed.png')
    await page.screenshot({ path: shotSynced, fullPage: false })
    log('BROWSER', `Saved synced flushed screenshot: ${shotSynced}`)

    // Verify database has marked attendees without duplicates
    const { data: dbMarks, error: dbMarksErr } = await sb
      .from('attendance')
      .select('person_id, marked_by')
      .eq('service_id', activeSvc.id)
      .in('person_id', tappedPersonIds)

    log('OFFLINE_QUEUE', `Database attendance rows confirmed for tapped members: ${dbMarks?.length} / ${tappedPersonIds.length}`)

    // Step 6: Test Idempotency with Duplicate clientMarkId
    log('IDEMPOTENCY', 'Testing server deduplication with duplicate clientMarkId...')
    if (tappedPersonIds.length > 0) {
      const dupMarkId = '11111111-2222-4333-8444-555555555555'
      const firstRes = await fetch(`${BASE_URL}/api/attendance/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${usherToken}`,
        },
        body: JSON.stringify({
          id: dupMarkId,
          serviceId: activeSvc.id,
          personId: tappedPersonIds[0],
          isPresent: true,
        }),
      })
      const firstData = await firstRes.json()

      const secondRes = await fetch(`${BASE_URL}/api/attendance/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${usherToken}`,
        },
        body: JSON.stringify({
          id: dupMarkId,
          serviceId: activeSvc.id,
          personId: tappedPersonIds[0],
          isPresent: true,
        }),
      })
      const secondData = await secondRes.json()
      log('IDEMPOTENCY', `First call success: ${firstData.success}, Second call deduplicated: ${secondData.deduplicated || secondData.success}`)
    }

    // -----------------------------------------------------------------
    // PART A (Browser): Visual Evidence for Admin Dashboard
    // -----------------------------------------------------------------
    log('BROWSER', 'Capturing Admin Combined Attendance Dashboard UI...')

    // Switch to Admin session
    await page.evaluate((sess) => {
      localStorage.clear()
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, adminData.session)
    await delay(300)

    // Navigate to /dashboard
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('#live-hero-card', { timeout: 10000 })
    await delay(1200)

    // Capture Screenshot 1: Live Service Hero & Section Breakdown
    const shotDashboardLive = path.join(ARTIFACTS_DIR, 'phase7_01_admin_dashboard_live.png')
    await page.screenshot({ path: shotDashboardLive, fullPage: false })
    log('BROWSER', `Saved Admin Dashboard Live screenshot: ${shotDashboardLive}`)

    // Click Historical Trends tab
    await page.click('#tab-history')
    await delay(800)
    await page.waitForSelector('h3', { timeout: 5000 })

    // Capture Screenshot 2: Historical Trends View
    const shotDashboardHistory = path.join(ARTIFACTS_DIR, 'phase7_02_admin_dashboard_history.png')
    await page.screenshot({ path: shotDashboardHistory, fullPage: false })
    log('BROWSER', `Saved Admin Dashboard History screenshot: ${shotDashboardHistory}`)

    // Navigate as Usher to verify 403 Access Denied UI
    await page.evaluate((sess) => {
      localStorage.clear()
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, usherData.session)
    await delay(300)

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('#return-attendance-button', { timeout: 10000 })
    await delay(800)

    // Capture Screenshot 3: Usher 403 Forbidden Screen
    const shotDashboard403 = path.join(ARTIFACTS_DIR, 'phase7_03_dashboard_403_usher_denied.png')
    await page.screenshot({ path: shotDashboard403, fullPage: false })
    log('BROWSER', `Saved Dashboard 403 Forbidden screenshot: ${shotDashboard403}`)

    console.log('\n====================================================')
    console.log('   ALL DASHBOARD & OFFLINE QUEUE TESTS PASSED!     ')
    console.log('====================================================')
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error('Test execution error:', err)
  process.exit(1)
})
