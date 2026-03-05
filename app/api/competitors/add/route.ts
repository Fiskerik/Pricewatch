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

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const admin = supabaseAdmin() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productId, url, label, initialPrice, initialCurrency } = await req.json()
  if (!productId || !url) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  let normalizedUrl = ''
  try {
    normalizedUrl = normalizeCompetitorUrl(String(url))
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Verify ownership: product → store → user
  const { data: product } = await supabase
    .from('products')
    .select('id, stores!inner(user_id)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Insert competitor URL
  const { data: competitor, error } = await admin
    .from('competitor_urls')
    .insert({
      product_id: productId,
      url: normalizedUrl,
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      last_price: initialPrice ?? null,
      last_price_currency: initialCurrency ? String(initialCurrency).toUpperCase() : null,
      last_checked_at: initialPrice ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[competitors/add] insert failed', {
      userId: user.id,
      productId,
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

  // Record initial price in history
  if (initialPrice && competitor) {
    await admin.from('price_history').insert({
      competitor_url_id: competitor.id,
      price: initialPrice,
    })
  }

  return NextResponse.json({ competitor })
}
