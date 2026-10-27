import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const today = new Date().toISOString().split('T')[0]

    // 1. Look for nearest upcoming service
    const { data: upcoming, error: upcomingErr } = await supabaseAdmin
      .from('services')
      .select('*')
      .gte('service_date', today)
      .order('service_date', { ascending: true })
      .order('service_time', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (upcoming && !upcomingErr) {
      return NextResponse.json({ service: upcoming })
    }

    // 2. If no future service, fallback to latest existing service
    const { data: latest, error: latestErr } = await supabaseAdmin
      .from('services')
      .select('*')
      .order('service_date', { ascending: false })
      .order('service_time', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest && !latestErr) {
      return NextResponse.json({ service: latest })
    }

    return NextResponse.json({ error: 'No services found' }, { status: 404 })
  } catch (err) {
    console.error('Error fetching service:', err)
    return NextResponse.json({ error: 'Failed to fetch service' }, { status: 500 })
  }
}
