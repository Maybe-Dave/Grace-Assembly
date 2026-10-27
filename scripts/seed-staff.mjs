/**
 * Seed or register a church staff member (admin or usher).
 * Usage:
 *   node --env-file=.env.local scripts/seed-staff.mjs <full_name> <email> <phone> <role>
 *
 * Example:
 *   node --env-file=.env.local scripts/seed-staff.mjs "David Dickson" "dicksondave2002@gmail.com" "+2348012345678" "admin"
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  process.exit(1)
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const fullName = process.argv[2] || 'David Dickson'
const email = (process.argv[3] || 'dicksondave2002@gmail.com').toLowerCase().trim()
const phone = process.argv[4] || '+2348000000001'
const role = (process.argv[5] || 'admin').toLowerCase()

if (!['admin', 'usher'].includes(role)) {
  console.error('Error: role must be either "admin" or "usher"')
  process.exit(1)
}

async function main() {
  console.log(`\nRegistering staff member:`)
  console.log(`  Name:  ${fullName}`)
  console.log(`  Email: ${email}`)
  console.log(`  Phone: ${phone}`)
  console.log(`  Role:  ${role}\n`)

  // 1. Get or create person in people table
  const { data: existingPerson, error: selectPersonErr } = await supabaseAdmin
    .from('people')
    .select('*')
    .ilike('email', email)
    .maybeSingle()

  if (selectPersonErr) {
    console.error('Error checking people table:', selectPersonErr.message)
    process.exit(1)
  }

  let person = existingPerson
  if (!person) {
    // Check if phone exists (phone has a UNIQUE constraint)
    const { data: phonePerson } = await supabaseAdmin
      .from('people')
      .select('id, full_name, email')
      .eq('phone', phone)
      .maybeSingle()

    if (phonePerson) {
      console.log(`Updating existing person with phone ${phone}...`)
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('people')
        .update({ email, full_name: fullName })
        .eq('id', phonePerson.id)
        .select()
        .single()
      if (updateErr) {
        console.error('Error updating person:', updateErr.message)
        process.exit(1)
      }
      person = updated
    } else {
      console.log('Inserting new person into people table...')
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('people')
        .insert({
          full_name: fullName,
          phone,
          email,
          status: 'active',
        })
        .select()
        .single()
      if (insertErr) {
        console.error('Error inserting person:', insertErr.message)
        process.exit(1)
      }
      person = inserted
    }
  } else {
    console.log(`Found existing person record: id=${person.id}`)
  }

  // 2. Ensure Supabase Auth user exists for this email
  const { data: userList, error: listUsersErr } = await supabaseAdmin.auth.admin.listUsers()
  if (listUsersErr) {
    console.error('Error listing auth users:', listUsersErr.message)
    process.exit(1)
  }

  let authUser = userList.users.find(u => u.email?.toLowerCase() === email)
  if (!authUser) {
    console.log('Creating auth.users entry via Supabase Admin...')
    const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createErr) {
      console.error('Error creating auth user:', createErr.message)
      process.exit(1)
    }
    authUser = createdUser.user
  }
  console.log(`Auth user id: ${authUser.id}`)

  // 3. Upsert staff_roles entry
  const { data: existingRole } = await supabaseAdmin
    .from('staff_roles')
    .select('*')
    .eq('user_id', authUser.id)
    .maybeSingle()

  if (existingRole) {
    if (existingRole.role !== role) {
      const { error: updateRoleErr } = await supabaseAdmin
        .from('staff_roles')
        .update({ role })
        .eq('user_id', authUser.id)
      if (updateRoleErr) {
        console.error('Error updating staff role:', updateRoleErr.message)
        process.exit(1)
      }
      console.log(`Updated staff_roles: user_id=${authUser.id} role=${role}`)
    } else {
      console.log(`staff_roles already set to ${role}`)
    }
  } else {
    console.log(`Inserting staff_roles: user_id=${authUser.id} role=${role}...`)
    const { error: insertRoleErr } = await supabaseAdmin
      .from('staff_roles')
      .insert({
        user_id: authUser.id,
        role,
      })
    if (insertRoleErr) {
      console.error('Error inserting staff role:', insertRoleErr.message)
      process.exit(1)
    }
    console.log(`Successfully added to staff_roles as ${role}`)
  }

  console.log(`\n✅ Setup complete!`)
  console.log(`  Email "${email}" is registered as ${role}.`)
  console.log(`  You can now sign in at the Welcome screen with this email.`)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
