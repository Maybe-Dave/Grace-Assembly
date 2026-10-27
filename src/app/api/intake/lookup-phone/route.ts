import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    let phone = (body?.phone ?? '').trim()

    if (!phone || phone.length < 5) {
      return NextResponse.json({ matched: false })
    }

    // Normalize phone: strip all non-digits, then build prefix variants
    const digitsOnly = phone.replace(/[^\d]/g, '')
    // Build equivalent forms: +234... ↔ 0...
    const variants = new Set<string>([digitsOnly])
    if (digitsOnly.startsWith('234') && digitsOnly.length > 6) {
      variants.add('0' + digitsOnly.slice(3)) // 234XXXXXXXX → 0XXXXXXXX
    }
    if (digitsOnly.startsWith('0') && digitsOnly.length > 5) {
      variants.add('234' + digitsOnly.slice(1)) // 0XXXXXXXX → 234XXXXXXXX
    }
    const cleanPhone = digitsOnly // primary form for RPC

    // 1. Try RPC check_phone_duplicate if available (RPC handles prefix normalization server-side)
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
        'check_phone_duplicate',
        { phone_query: cleanPhone }
      )
      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        const row = rpcData[0]
        return NextResponse.json({
          matched: true,
          person: {
            id: row.matched_person_id,
            full_name: row.matched_name,
            unit_name: row.matched_unit,
            section: row.matched_section || 'Adults & Youth',
          },
        })
      }
    } catch (_) {}

    // 2. Query people table directly as fallback
    const { data: peopleData, error: queryErr } = await supabaseAdmin
      .from('people')
      .select('id, full_name, phone, section, unit_id, units(name)')
      .eq('status', 'active')

    if (queryErr || !peopleData) {
      return NextResponse.json({ matched: false })
    }

    // Match phone by normalizing each stored number and comparing against all variants
    const matched = peopleData.find((p) => {
      const storedDigits = (p.phone ?? '').replace(/[^\d]/g, '')
      return variants.has(storedDigits)
    })

    if (matched) {
      return NextResponse.json({
        matched: true,
        person: {
          id: matched.id,
          full_name: matched.full_name,
          phone: matched.phone,
          unit_name: (matched as any).units?.name || 'Member',
          section: (matched as any).section || 'Adults & Youth',
        },
      })
    }

    return NextResponse.json({ matched: false })
  } catch (err) {
    console.error('Error in /api/intake/lookup-phone:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
