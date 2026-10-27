import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function seedHistory() {
  console.log('Seeding historical services for Admin Dashboard trends...')

  const { data: people } = await sb.from('people').select('id, section').eq('status', 'active')
  if (!people || people.length === 0) {
    console.log('No people found to mark historical attendance')
    return
  }

  const pastServices = [
    {
      id: '99000000-0000-0000-0000-000000000001',
      type: 'Sunday Service',
      service_date: '2026-11-01',
      service_time: '09:00:00',
    },
    {
      id: '99000000-0000-0000-0000-000000000002',
      type: 'Sunday Service',
      service_date: '2026-10-25',
      service_time: '09:00:00',
    },
  ]

  for (const svc of pastServices) {
    const { error: svcErr } = await sb.from('services').upsert(svc)
    if (svcErr) {
      console.warn('Upsert service error:', svcErr.message)
    }

    // Mark a subset of people present
    const countToMark = svc.service_date === '2026-11-01' ? 16 : 14
    const selectedPeople = people.slice(0, Math.min(countToMark, people.length))

    const { data: staffList } = await sb.from('staff_roles').select('user_id').limit(1)
    const realStaffId = staffList?.[0]?.user_id

    const marks = selectedPeople.map((p) => ({
      service_id: svc.id,
      person_id: p.id,
      marked_by: realStaffId,
      marked_at: `${svc.service_date}T09:30:00Z`,
    }))

    const { error: attErr } = await sb.from('attendance').upsert(marks, { onConflict: 'service_id,person_id' })
    if (attErr) {
      console.warn('Upsert attendance error:', attErr.message)
    }
  }

  console.log('Historical services seeded successfully.')
}

seedHistory().catch(console.error)
