import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables!')
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const SERVICE_ID = '84a36129-1a53-46ff-9115-d4096a267bd3'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = process.env.TEST_PORT || '3001'
const BASE_URL = `http://localhost:${PORT}`

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runAcceptanceTests() {
  console.log('====================================================')
  console.log(` GRACE ASSEMBLY — PHASE 5 OFFLINE TESTS (${BASE_URL}) `)
  console.log('====================================================\n')

  // Step 0: Ensure we have a valid auth token for the test staff user
  console.log('--- Step 0: Authenticating test staff user (dicksondave2002@gmail.com) ---')
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'dicksondave2002@gmail.com',
  })

  if (linkError) {
    console.error('GenerateLink error:', linkError)
    process.exit(1)
  }

  const { data: sessionData, error: sessionError } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  })

  if (sessionError || !sessionData.session) {
    console.error('VerifyOtp error:', sessionError)
    process.exit(1)
  }

  const session = sessionData.session
  console.log('Successfully acquired valid Supabase session for:', session.user.email)

  // Launch Chrome
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  try {
    // 1. Establish session in localStorage
    console.log('Injecting auth session into browser storage...')
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await page.evaluate((sess) => {
      localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
    }, session)

    // Clean any prior attendance for this test service
    console.log('Resetting attendance table for service:', SERVICE_ID)
    await supabaseAdmin.from('attendance').delete().eq('service_id', SERVICE_ID)

    // Navigate to attendance page
    console.log(`Navigating to ${BASE_URL}/attendance ...`)
    await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
    await delay(1500)

    // Wait for attendance page to load
    await page.waitForSelector('button[id^="toggle-person-"]', { timeout: 10000 })
    console.log('Attendance page loaded with member toggles!')

    // Ensure Service Worker is registered and /attendance + all static assets are precached
    await page.evaluate(async (origin) => {
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready
          console.log('[SW] Ready:', reg.scope)
          const cache = await caches.open('grace-assembly-v1')
          await cache.add('/attendance')
          await cache.add('/')

          const scriptUrls = Array.from(document.querySelectorAll('script[src]'))
            .map((s) => s.src)
            .filter((url) => url.startsWith(origin))
          const linkUrls = Array.from(document.querySelectorAll('link[href]'))
            .map((l) => l.href)
            .filter((url) => url.startsWith(origin))

          for (const url of [...new Set([...scriptUrls, ...linkUrls])]) {
            try {
              await cache.add(url)
            } catch (_) {}
          }
          console.log('[SW] Successfully precached static assets:', scriptUrls.length + linkUrls.length)
        } catch (e) {
          console.warn('[SW] Cache add warning:', e)
        }
      }
    }, BASE_URL)
    await delay(1000)

    console.log('\n----------------------------------------------------')
    console.log('TEST 1: Offline Mode & Collapse-to-Final-State')
    console.log('----------------------------------------------------')

    // Turn ON offline mode
    console.log('1. Setting browser offline (airplane mode ON)...')
    await page.setOfflineMode(true)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await delay(300)

    const memberToggles = await page.$$('button[id^="toggle-person-"]')
    console.log(`Found ${memberToggles.length} member toggle buttons`)

    if (memberToggles.length < 5) {
      throw new Error(`Need at least 5 members to test, found ${memberToggles.length}`)
    }

    // Mark 5 people:
    // Person 0: Tap once (Present)
    // Person 1: Tap once (Present)
    // Person 2: Tap once (Present)
    // Person 3: Tap once (Present)
    // Person 4: Tap THREE times: Present -> Absent -> Present (testing collapse)
    console.log('Tapping Person 0 (tap 1 -> Present)...')
    await memberToggles[0].click()
    await delay(100)

    console.log('Tapping Person 1 (tap 1 -> Present)...')
    await memberToggles[1].click()
    await delay(100)

    console.log('Tapping Person 2 (tap 1 -> Present)...')
    await memberToggles[2].click()
    await delay(100)

    console.log('Tapping Person 3 (tap 1 -> Present)...')
    await memberToggles[3].click()
    await delay(100)

    console.log('Tapping Person 4 (tap 1 -> Present)...')
    await memberToggles[4].click()
    await delay(150)
    console.log('Tapping Person 4 (tap 2 -> Absent)...')
    await memberToggles[4].click()
    await delay(150)
    console.log('Tapping Person 4 (tap 3 -> Present)...')
    await memberToggles[4].click()
    await delay(300)

    // Verify UI updated instantly for all 5
    const checkedStates = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[id^="toggle-person-"]')).slice(0, 5)
      return btns.map((btn) => btn.getAttribute('aria-checked'))
    })
    console.log('UI Aria-Checked states for first 5 members:', checkedStates)

    // Verify queued count in UI
    const syncBadgeText = await page.evaluate(() => {
      const badge = document.getElementById('sync-status-badge')
      return badge ? badge.innerText.trim() : null
    })
    console.log('Sync status badge text in UI:', syncBadgeText)

    // Verify IndexedDB queue directly
    const idbQueue = await page.evaluate(async () => {
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

    console.log(`IndexedDB queue items count: ${idbQueue.length}`)
    console.log('Queued items:', idbQueue.map((q) => ({ key: q.key, isPresent: q.isPresent })))

    const ac1UiInstant = checkedStates.every((s) => s === 'true')
    const ac1QueueCount = idbQueue.length === 5
    const ac1BadgeText = syncBadgeText?.includes('5 not yet synced')
    const ac1Passed = ac1UiInstant && ac1QueueCount && ac1BadgeText

    console.log(`Instant UI update for 5: ${ac1UiInstant}`)
    console.log(`Queue collapsed to exactly 5 items: ${ac1QueueCount}`)
    console.log(`Badge displays "[N] not yet synced" (5): ${ac1BadgeText}`)
    console.log(`>>> ACCEPTANCE CRITERION 1: ${ac1Passed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

    console.log('----------------------------------------------------')
    console.log('TEST 2 & 3: Reconnect Online & DB Verification')
    console.log('----------------------------------------------------')

    // Turn airplane mode OFF
    console.log('2. Setting browser online (airplane mode OFF)...')
    await page.setOfflineMode(false)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
    })

    // Poll IndexedDB queue count until 0 or timeout (max 10s)
    console.log('Waiting for sequential sync to drain queue...')
    let remaining = 5
    for (let i = 0; i < 20; i++) {
      await delay(500)
      remaining = await page.evaluate(async () => {
        return new Promise((resolve) => {
          const req = indexedDB.open('grace_assembly_offline_db', 1)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('attendance_queue', 'readonly')
            const store = tx.objectStore('attendance_queue')
            const countReq = store.count()
            countReq.onsuccess = () => resolve(countReq.result)
            countReq.onerror = () => resolve(999)
          }
          req.onerror = () => resolve(999)
        })
      })
      if (remaining === 0) break
    }

    console.log(`IndexedDB queue count after sync: ${remaining}`)

    const badgeAfterSync = await page.evaluate(() => {
      const badge = document.getElementById('sync-status-badge')
      return badge ? badge.innerText.trim() : 'Cleared / None'
    })
    console.log('Sync status badge after sync:', badgeAfterSync)

    // Direct Supabase table query
    console.log('\n3. Direct Supabase Query on attendance table:')
    const { data: dbAttendance, error: dbError } = await supabaseAdmin
      .from('attendance')
      .select('id, service_id, person_id, marked_by, marked_at, people(full_name)')
      .eq('service_id', SERVICE_ID)
      .order('marked_at', { ascending: true })

    if (dbError) {
      console.error('Supabase query error:', dbError)
    }

    console.log(`Total attendance rows in Supabase: ${dbAttendance?.length || 0}`)
    console.table(
      dbAttendance?.map((r) => ({
        person: r.people?.full_name,
        person_id: r.person_id.substring(0, 8) + '...',
        marked_at: r.marked_at,
      }))
    )

    const ac2Passed = remaining === 0
    const ac3Passed = dbAttendance?.length === 5

    console.log(`>>> ACCEPTANCE CRITERION 2 (Auto Reconnect Sync): ${ac2Passed ? 'PASSED ✅' : 'FAILED ❌'}`)
    console.log(`>>> ACCEPTANCE CRITERION 3 (Supabase Exact Match): ${ac3Passed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

    console.log('----------------------------------------------------')
    console.log('TEST 4 & 5: Persist Across Tab Close & Reopen')
    console.log('----------------------------------------------------')

    // Go offline again
    console.log('4. Going offline again...')
    await page.setOfflineMode(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await delay(300)

    // Unmark Person 0 and Person 1
    console.log('Offline: unmarking Person 0 and Person 1 (Present -> Absent)...')
    const currentToggles = await page.$$('button[id^="toggle-person-"]')
    await currentToggles[0].click()
    await delay(100)
    await currentToggles[1].click()
    await delay(300)

    const countBeforeClose = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('grace_assembly_offline_db', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attendance_queue', 'readonly')
          const countReq = tx.objectStore('attendance_queue').count()
          countReq.onsuccess = () => resolve(countReq.result)
        }
      })
    })
    console.log(`IndexedDB queued count before closing tab: ${countBeforeClose}`)

    // Close the tab entirely
    console.log('Closing page/tab completely...')
    await page.close()

    // Open a brand new page while STILL offline
    console.log('Opening a brand new tab while STILL offline...')
    const newPage = await browser.newPage()
    await newPage.setViewport({ width: 1280, height: 900 })
    await newPage.setOfflineMode(true)

    // Load attendance page offline
    console.log(`Navigating to ${BASE_URL}/attendance while offline...`)
    try {
      await newPage.goto(`${BASE_URL}/attendance`, { waitUntil: 'domcontentloaded' })
    } catch (e) {
      console.log('[NewPage Goto Error]:', e.message)
    }

    await newPage.waitForSelector('button[id^="toggle-person-"]', { timeout: 8000 }).catch(() => null)
    await delay(1000)

    // Check if queued count is restored from IndexedDB
    const reopenedBadgeText = await newPage.evaluate(() => {
      const badge = document.getElementById('sync-status-badge')
      return badge ? badge.innerText.trim() : null
    })
    console.log('Sync status badge on reopened offline page:', reopenedBadgeText)

    const reopenedQueue = await newPage.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('grace_assembly_offline_db', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attendance_queue', 'readonly')
          const getAllReq = tx.objectStore('attendance_queue').getAll()
          getAllReq.onsuccess = () => resolve(getAllReq.result)
        }
      })
    })
    console.log(`IndexedDB queue on reopened page has ${reopenedQueue.length} items`)

    // Verify Person 0 and Person 1 aria-checked is false
    const reopenedCheckedStates = await newPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[id^="toggle-person-"]')).slice(0, 5)
      return btns.map((btn) => btn.getAttribute('aria-checked'))
    })
    console.log('Reopened page Aria-Checked states (Person 0 and 1 should be false):', reopenedCheckedStates)

    const ac4Passed =
      reopenedQueue.length === 2 &&
      reopenedBadgeText?.includes('2 not yet synced') &&
      reopenedCheckedStates[0] === 'false' &&
      reopenedCheckedStates[1] === 'false'

    console.log(`>>> ACCEPTANCE CRITERION 4 (Offline Tab Close Persistence): ${ac4Passed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

    // Criterion 5: Reconnect online from reopened state
    console.log('5. Reconnecting online from reopened tab...')
    await newPage.setOfflineMode(false)
    await newPage.evaluate(() => window.dispatchEvent(new Event('online')))

    let finalCount = 2
    for (let i = 0; i < 20; i++) {
      await delay(500)
      finalCount = await newPage.evaluate(async () => {
        return new Promise((resolve) => {
          const req = indexedDB.open('grace_assembly_offline_db', 1)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('attendance_queue', 'readonly')
            const countReq = tx.objectStore('attendance_queue').count()
            countReq.onsuccess = () => resolve(countReq.result)
          }
        })
      })
      if (finalCount === 0) break
    }

    console.log(`Queue count after sync in reopened page: ${finalCount}`)

    const { data: dbAfterUnmark } = await supabaseAdmin
      .from('attendance')
      .select('id, person_id, people(full_name)')
      .eq('service_id', SERVICE_ID)

    console.log(`Supabase rows count now: ${dbAfterUnmark?.length} (expected 3 rows remaining)`)

    const ac5Passed = finalCount === 0 && dbAfterUnmark?.length === 3
    console.log(`>>> ACCEPTANCE CRITERION 5 (Sync from Reopened State): ${ac5Passed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

    console.log('----------------------------------------------------')
    console.log('TEST 6: Simulated Sync Failure & Retry')
    console.log('----------------------------------------------------')

    // Enable request interception to fail the sync endpoint
    await newPage.setRequestInterception(true)
    let interceptEnabled = true

    newPage.on('request', (req) => {
      if (interceptEnabled && req.url().includes('/api/attendance/toggle')) {
        console.log('[Interceptor] Simulated 500 Failure injected on /api/attendance/toggle')
        req.respond({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated 500 Server Outage' }),
        })
      } else {
        req.continue()
      }
    })

    // Toggle Person 2 (Present -> Absent)
    console.log('Toggling Person 2 while endpoint fails with 500...')
    const toggles = await newPage.$$('button[id^="toggle-person-"]')
    await toggles[2].click()
    await delay(1200)

    // Check IndexedDB queue: item must NOT disappear, must remain with retryCount >= 1 and error
    const failureQueue = await newPage.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('grace_assembly_offline_db', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attendance_queue', 'readonly')
          const getAllReq = tx.objectStore('attendance_queue').getAll()
          getAllReq.onsuccess = () => resolve(getAllReq.result)
        }
      })
    })

    console.log(`Queue size after failure: ${failureQueue.length}`)
    console.log('Failed item in IndexedDB:', failureQueue.map((q) => ({ key: q.key, retries: q.retryCount, error: q.lastError })))

    const ac6FailedKept = failureQueue.length === 1 && (failureQueue[0].retryCount || 0) >= 1

    // Now restore normal behavior and retry sync
    console.log('Restoring normal endpoint behavior and re-triggering sync...')
    interceptEnabled = false

    await newPage.evaluate(() => {
      window.dispatchEvent(new Event('online'))
    })

    let drainedAfterRetry = false
    for (let i = 0; i < 20; i++) {
      await delay(500)
      const count = await newPage.evaluate(async () => {
        return new Promise((resolve) => {
          const req = indexedDB.open('grace_assembly_offline_db', 1)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('attendance_queue', 'readonly')
            const countReq = tx.objectStore('attendance_queue').count()
            countReq.onsuccess = () => resolve(countReq.result)
          }
        })
      })
      if (count === 0) {
        drainedAfterRetry = true
        break
      }
    }

    console.log(`Queue count after recovery retry: ${drainedAfterRetry ? 0 : 'non-zero'}`)
    const ac6Passed = ac6FailedKept && drainedAfterRetry
    console.log(`>>> ACCEPTANCE CRITERION 6 (Simulated Failure Stays Queued & Retries): ${ac6Passed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

    console.log('====================================================')
    console.log('         PHASE 5 ACCEPTANCE TEST SUMMARY            ')
    console.log('====================================================')
    console.log(`Criterion 1: Offline Collapse & Instant UI:   ${ac1Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log(`Criterion 2: Auto Reconnect Sequential Sync:  ${ac2Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log(`Criterion 3: Supabase DB Exact Match:         ${ac3Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log(`Criterion 4: Persist Across Tab Close/Reopen: ${ac4Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log(`Criterion 5: Sync from Reopened Tab:          ${ac5Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log(`Criterion 6: Simulated Failure Retries:       ${ac6Passed ? 'PASS ✅' : 'FAIL ❌'}`)
    console.log('====================================================')

    if (ac1Passed && ac2Passed && ac3Passed && ac4Passed && ac5Passed && ac6Passed) {
      console.log('\n🎉 ALL 6 PHASE 5 ACCEPTANCE CRITERIA VERIFIED AND PASSED!')
    } else {
      console.error('\n❌ SOME CRITERIA FAILED!')
      process.exitCode = 1
    }
  } catch (err) {
    console.error('Test execution error:', err)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

runAcceptanceTests()
