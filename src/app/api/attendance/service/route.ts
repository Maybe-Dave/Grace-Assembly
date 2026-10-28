import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    // 1. Look for active service where status = 'active'
    try {
      const { data: activeService, error: activeErr } = await supabaseAdmin
        .from('services')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!activeErr && activeService) {
        return NextResponse.json({ service: activeService, isActive: true })
      }
    } catch (_) {}

    // 2. Check local active service fallback
    try {
      const tempFile = path.join(process.cwd(), '.temp_data', 'active_service.json')
      if (fs.existsSync(tempFile)) {
        const stored = JSON.parse(fs.readFileSync(tempFile, 'utf-8'))
        if (stored) {
          return NextResponse.json({ service: stored, isActive: true })
        }
      }
    } catch (_) {}

    const today = new Date().toISOString().split('T')[0]

    // 3. Fallback: nearest upcoming service
    const { data: upcoming, error: upcomingErr } = await supabaseAdmin
      .from('services')
      .select('*')
      .gte('service_date', today)
      .order('service_date', { ascending: true })
      .order('service_time', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (upcoming && !upcomingErr) {
      return NextResponse.json({ service: upcoming, isActive: false })
    }

    // 4. Fallback: latest existing service
    const { data: latest, error: latestErr } = await supabaseAdmin
      .from('services')
      .select('*')
      .order('service_date', { ascending: false })
      .order('service_time', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest && !latestErr) {
      return NextResponse.json({ service: latest, isActive: false })
    }

    return NextResponse.json({ error: 'No services found', service: null, isActive: false }, { status: 404 })
  } catch (err) {
    console.error('Error fetching service:', err)
    return NextResponse.json({ error: 'Failed to fetch service' }, { status: 500 })
  }
}
