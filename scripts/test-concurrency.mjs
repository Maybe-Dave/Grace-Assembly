import http from 'http'

async function postJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const body = JSON.stringify(data)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode, raw })
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        method: 'GET',
        headers,
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode, raw })
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  console.log('--- Step 3: Concurrency Test Starting ---')

  // 1. Get active service
  const svcRes = await getJson('http://localhost:3000/api/attendance/service')
  const serviceId = svcRes.data?.service?.id
  console.log(`Active Service ID: ${serviceId}`)

  // 2. Login Staff A (Adults & Youth)
  const staffALogin = await postJson('http://localhost:3000/api/auth/dev-login', {
    email: 'usher_adults@example.com',
    role: 'attendance_staff',
    section: 'Adults & Youth',
  })
  const tokenA = staffALogin.data.session.access_token

  // 3. Login Staff B (Teenagers)
  const staffBLogin = await postJson('http://localhost:3000/api/auth/dev-login', {
    email: 'usher_teens@example.com',
    role: 'attendance_staff',
    section: 'Teenagers',
  })
  const tokenB = staffBLogin.data.session.access_token

  // 4. Fetch roster for Section A and Section B
  const rosterARes = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Adults & Youth' },
    { Authorization: `Bearer ${tokenA}` }
  )
  const rosterBRes = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Teenagers' },
    { Authorization: `Bearer ${tokenB}` }
  )

  console.log('rosterARes status:', rosterARes.status, rosterARes.data)
  console.log('rosterBRes status:', rosterBRes.status, rosterBRes.data)

  // Find un-marked attendees in each room
  const personA = rosterARes.data?.people?.find((p) => !p.is_present) || rosterARes.data?.people?.[0]
  const personB = rosterBRes.data?.people?.find((p) => !p.is_present) || rosterBRes.data?.people?.[0]

  console.log(`Staff A targeting Person in Adults & Youth: ${personA?.full_name} (${personA?.id})`)
  console.log(`Staff B targeting Person in Teenagers: ${personB?.full_name} (${personB?.id})`)

  // 5. Fire concurrent toggles simultaneously!
  console.log('Firing simultaneous concurrent mark requests...')
  const [toggleA, toggleB] = await Promise.all([
    postJson(
      'http://localhost:3000/api/attendance/toggle',
      {
        personId: personA.id,
        serviceId,
        isPresent: true,
      },
      { Authorization: `Bearer ${tokenA}` }
    ),
    postJson(
      'http://localhost:3000/api/attendance/toggle',
      {
        personId: personB.id,
        serviceId,
        isPresent: true,
      },
      { Authorization: `Bearer ${tokenB}` }
    ),
  ])

  console.log('Staff A response:', toggleA.status, toggleA.data)
  console.log('Staff B response:', toggleB.status, toggleB.data)

  // 6. Login as Super Admin and inspect Dashboard Stats
  const adminLogin = await postJson('http://localhost:3000/api/auth/dev-login', {
    role: 'super_admin',
  })
  const tokenAdmin = adminLogin.data.session.access_token

  const statsRes = await getJson('http://localhost:3000/api/dashboard/stats', {
    Authorization: `Bearer ${tokenAdmin}`,
  })

  const actSvc = statsRes.data?.activeService

  console.log('\n--- Dashboard Statistics After Concurrent Marking ---')
  console.log('Active Service:', actSvc?.type)
  console.log('Total Present:', actSvc?.combinedPresent)
  console.log('Total Roster:', actSvc?.combinedTotal)
  console.log('Turnout %:', actSvc?.combinedPercent + '%')
  console.log('Breakdown by Room:')
  actSvc?.sections?.forEach((r) => {
    console.log(`  - ${r.section}: ${r.present} / ${r.total} present (${r.percent}%)`)
    if (r.activeUshers?.length) {
      console.log(`    Active Ushers: ${r.activeUshers.map((u) => `${u.name} (${u.marks})`).join(', ')}`)
    }
  })

  // Concurrency Verification Checks
  const adultsPresent = actSvc?.sections?.find((r) => r.section === 'Adults & Youth')?.present
  const teensPresent = actSvc?.sections?.find((r) => r.section === 'Teenagers')?.present

  if (adultsPresent > 0 && teensPresent > 0 && toggleA.data?.success && toggleB.data?.success) {
    console.log('\n✅ PASS: Both sections marked independently without collision or overwrite!')
  } else {
    console.log('\n❌ FAIL: Collision or missing mark in section stats!')
  }
}

main().catch(console.error)
