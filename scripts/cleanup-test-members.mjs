import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
  process.exit(1)
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

// The 12 fictional member IDs seeded for Phase 3 testing
const TEST_MEMBER_PHONES = [
  '+2348031112233',
  '+2348032223344',
  '+2348033334455',
  '+2348034445566',
  '+2348035556677',
  '+2348036667788',
  '+2348037778899',
  '+2348038889900',
  '+2348039990011',
  '+2348021112233',
  '+2348022223344',
  '+2348023334455',
]

async function cleanup() {
  console.log('--- Cleaning Up Phase 3 Fictional Test Members ---')

  // 1. Locate the test members in `people`
  const { data: testPeople, error: findErr } = await supabaseAdmin
    .from('people')
    .select('id, full_name, phone')
    .in('phone', TEST_MEMBER_PHONES)

  if (findErr) {
    console.error('Error querying people table:', findErr)
    process.exit(1)
  }

  if (!testPeople || testPeople.length === 0) {
    console.log('No test members found. Database is already clean.')
    return
  }

  const ids = testPeople.map((p) => p.id)
  console.log(`Found ${testPeople.length} test members:`)
  testPeople.forEach((p) => console.log(` - ${p.full_name} (${p.phone})`))

  // 2. Remove any attendance records for these members
  const { data: deletedAttendance, error: attErr } = await supabaseAdmin
    .from('attendance')
    .delete()
    .in('person_id', ids)
    .select()

  if (attErr) {
    console.error('Error removing test attendance records:', attErr)
    process.exit(1)
  }
  console.log(`Removed ${deletedAttendance?.length ?? 0} attendance records for test members.`)

  // 3. Delete the members from `people`
  const { data: deletedPeople, error: delErr } = await supabaseAdmin
    .from('people')
    .delete()
    .in('id', ids)
    .select()

  if (delErr) {
    console.error('Error removing test people records:', delErr)
    process.exit(1)
  }

  console.log(`Successfully deleted ${deletedPeople?.length ?? 0} test member records from people table.`)
  console.log('Real staff and member accounts remain untouched.')
}

cleanup().catch((err) => {
  console.error('Cleanup script error:', err)
  process.exit(1)
})
