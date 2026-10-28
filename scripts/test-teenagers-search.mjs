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
  console.log('--- Step 6: Testing Search & Add in Teenagers and Older Children ---')

  // 1. Get active service
  const svcRes = await getJson('http://localhost:3000/api/attendance/service')
  const serviceId = svcRes.data?.service?.id
  console.log(`Active Service ID: ${serviceId}`)

  // 2. Login as attendance_admin
  const adminLogin = await postJson('http://localhost:3000/api/auth/dev-login', {
    role: 'attendance_admin',
  })
  const token = adminLogin.data.session.access_token

  // 3. Search in Teenagers
  console.log('\nSearching for Teenagers roster...')
  const teensRoster = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Teenagers' },
    { Authorization: `Bearer ${token}` }
  )
  console.log(`Teenagers count: ${teensRoster.data.people.length}`)
  teensRoster.data.people.forEach((p) => {
    console.log(`  - ${p.full_name} | Unit: ${p.unit_name} | Section: ${p.section} | Present: ${p.is_present}`)
  })

  // Search by query in Teenagers
  console.log('\nSearching query "Chinedu" in Teenagers...')
  const searchChinedu = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Teenagers', query: 'chinedu' },
    { Authorization: `Bearer ${token}` }
  )
  console.log(`Found: ${searchChinedu.data.people.length} results`)
  if (searchChinedu.data.people.length === 1 && searchChinedu.data.people[0].full_name === 'Chinedu Eze') {
    console.log('✅ PASS: Successfully searched by name in Teenagers!')
  } else {
    console.log('❌ FAIL: Search in Teenagers failed')
  }

  // 4. Search in Older Children
  console.log('\nSearching for Older Children roster...')
  const olderChildrenRoster = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Older Children' },
    { Authorization: `Bearer ${token}` }
  )
  console.log(`Older Children count: ${olderChildrenRoster.data.people.length}`)
  olderChildrenRoster.data.people.forEach((p) => {
    console.log(`  - ${p.full_name} | Unit: ${p.unit_name} | Section: ${p.section} | Present: ${p.is_present}`)
  })

  // 5. Submit a new person in "Older Children" via /api/intake/submit
  console.log('\nSubmitting new attendee in Older Children section...')
  const submitRes = await postJson(
    'http://localhost:3000/api/intake/submit',
    {
      fullName: 'Little David Child',
      phone: '08099887766',
      section: 'Older Children',
      unit: 'Children',
      statusFlag: 'first_time',
    },
    { Authorization: `Bearer ${token}` }
  )
  const pendingId = submitRes.data.pendingId || submitRes.data.pendingPerson?.id
  console.log(`Submitted pending record ID: ${pendingId}`)

  // 6. Approve as new person via /api/intake/action
  console.log('Approving new attendee in Older Children...')
  const approveRes = await postJson(
    'http://localhost:3000/api/intake/action',
    {
      pendingId,
      action: 'approve_new',
    },
    { Authorization: `Bearer ${token}` }
  )
  console.log('Approve response:', approveRes.data?.success ? 'Success' : approveRes.data)

  // 7. Verify the new attendee appears in "Older Children" search
  console.log('\nSearching for "Little David Child" in Older Children...')
  const verifyOlder = await postJson(
    'http://localhost:3000/api/attendance/search',
    { serviceId, section: 'Older Children', query: 'little david' },
    { Authorization: `Bearer ${token}` }
  )
  console.log(`Search result: ${verifyOlder.data.people.length} found`)
  if (verifyOlder.data.people.length === 1 && verifyOlder.data.people[0].full_name === 'Little David Child') {
    console.log(`  - Name: ${verifyOlder.data.people[0].full_name}`)
    console.log(`  - Section: ${verifyOlder.data.people[0].section}`)
    console.log(`  - Marked Present: ${verifyOlder.data.people[0].is_present}`)
    console.log('✅ PASS: Add & search in Older Children confirmed working!')
  } else {
    console.log('❌ FAIL: Newly added child not found in Older Children!')
  }
}

main().catch(console.error)
