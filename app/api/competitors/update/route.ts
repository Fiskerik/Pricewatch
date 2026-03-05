import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'


function normalizeCompetitorUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim())
  parsed.hash = ''
  const normalizedPath = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = normalizedPath || '/'
  return parsed.toString()
}

export async function PATCH(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const admin = supabaseAdmin() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId, url, label, updatedPrice, updatedCurrency } = await req.json()
  if (!competitorId || !url) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  let normalizedUrl = ''
  try {
    normalizedUrl = normalizeCompetitorUrl(String(url))
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const { data: competitorWithOwner } = await supabase
    .from('competitor_urls')
    .select('id, products!inner(stores!inner(user_id))')
    .eq('id', competitorId)
    .eq('products.stores.user_id', user.id)
    .single()

  if (!competitorWithOwner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updatePayload: Record<string, unknown> = {
    url: normalizedUrl,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
  }

  if (typeof updatedPrice === 'number' && Number.isFinite(updatedPrice)) {
    updatePayload.last_price = updatedPrice
    updatePayload.last_checked_at = new Date().toISOString()
  }

  if (typeof updatedCurrency === 'string' && updatedCurrency.trim()) {
    updatePayload.last_price_currency = updatedCurrency.trim().toUpperCase()
  }

  const { data: competitor, error } = await admin
    .from('competitor_urls')
    .update(updatePayload)
    .eq('id', competitorId)
    .select()
    .single()

  if (error) {
    console.error('[competitors/update] update failed', {
      userId: user.id,
      competitorId,
      normalizedUrl,
      message: error.message,
      code: error.code,
      details: error.details,
    })
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This competitor URL is already added for this product.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ competitor })
}
