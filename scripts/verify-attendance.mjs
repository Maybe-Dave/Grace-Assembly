import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

const serviceId = '84a36129-1a53-46ff-9115-d4096a267bd3'

const { data, error } = await supabaseAdmin
  .from('attendance')
  .select('id, service_id, person_id, marked_by, marked_at, people(full_name)')
  .eq('service_id', serviceId)
  .order('marked_at', { ascending: true })

if (error) {
  console.error('Query error:', error)
} else {
  console.log('Query: SELECT id, service_id, person_id, marked_by, marked_at, people(full_name) FROM attendance WHERE service_id = \'' + serviceId + '\' ORDER BY marked_at ASC;')
  console.log('Total Rows:', data.length)
  console.log('Result Data:')
  console.log(JSON.stringify(data, null, 2))
}
