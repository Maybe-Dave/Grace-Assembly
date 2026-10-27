import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const SERVICE_ID = '84a36129-1a53-46ff-9115-d4096a267bd3'
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE_URL = 'http://localhost:3001'
const ARTIFACTS_DIR = 'C:\\Users\\WHITESYSTEM\\.gemini\\antigravity-ide\\brain\\105303f6-2bb5-458b-a524-506e149b61fd'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function captureEvidence() {
  const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'dicksondave2002@gmail.com',
  })

  const { data: sessionData } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  })

  const session = sessionData.session

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=430,932'], // Mobile viewport iPhone 14 Pro Max
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 932, isMobile: true, hasTouch: true })

  // 1. Establish session
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
  await page.evaluate((sess) => {
    localStorage.setItem('sb-xvnussqofsdyffypiulp-auth-token', JSON.stringify(sess))
  }, session)

  // Navigate to attendance
  await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'networkidle2' })
  await delay(1500)
  await page.waitForSelector('button[id^="toggle-person-"]', { timeout: 10000 })

  // Screenshot 1: Online baseline
  const shot1 = path.join(ARTIFACTS_DIR, 'phase5_01_all_synced_baseline.png')
  await page.screenshot({ path: shot1, fullPage: false })
  console.log('Saved baseline screenshot:', shot1)

  // Turn offline
  await page.setOfflineMode(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await delay(300)

  // Toggle 3 members
  const toggles = await page.$$('button[id^="toggle-person-"]')
  await toggles[0].click()
  await delay(100)
  await toggles[1].click()
  await delay(100)
  await toggles[2].click()
  await delay(500)

  // Screenshot 2: Offline with 3 queued items & calm badge
  const shot2 = path.join(ARTIFACTS_DIR, 'phase5_02_offline_3_items_queued.png')
  await page.screenshot({ path: shot2, fullPage: false })
  console.log('Saved offline queued screenshot:', shot2)

  // Turn online and capture syncing -> synced
  await page.setOfflineMode(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await delay(2500)

  // Screenshot 3: Auto synced
  const shot3 = path.join(ARTIFACTS_DIR, 'phase5_03_online_auto_synced.png')
  await page.screenshot({ path: shot3, fullPage: false })
  console.log('Saved online synced screenshot:', shot3)

  await browser.close()
  console.log('Evidence screenshot capture complete!')
}

captureEvidence()
