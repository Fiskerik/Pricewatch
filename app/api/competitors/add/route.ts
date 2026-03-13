import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { cleanUrl } from '@/lib/scraper'
import { evaluateCompetitorMatch, runCompetitorPreflight } from '@/lib/competitorMatch'

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
    normalizedUrl = normalizeCompetitorUrl(cleanUrl(String(url)))
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const { data: product } = await supabase
    .from('products')
    .select('*, stores!inner(user_id)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  let preflightSignals = null as any
  let matchConfidence = 0
  let mismatchReasons: string[] = []

  try {
    preflightSignals = await runCompetitorPreflight(normalizedUrl)
    const productMeta = {
      title: (product as any)?.title ?? null,
      handle: (product as any)?.handle ?? null,
      variant: (product as any)?.variant_title ?? null,
      brand: (product as any)?.brand ?? (product as any)?.vendor ?? null,
      size: (product as any)?.size ?? null,
    }
    const evaluation = evaluateCompetitorMatch(productMeta, preflightSignals)
    matchConfidence = evaluation.confidence
    mismatchReasons = evaluation.reasons
    console.log('[competitors/add] preflight result', {
      productId,
      normalizedUrl,
      confidence: matchConfidence,
      mismatchReasons,
      matchedSignals: evaluation.matchedSignals,
    })
  } catch (err) {
    mismatchReasons = ['Unable to verify product signals from the competitor page during preflight scrape.']
    matchConfidence = 0.2
    console.log('[competitors/add] preflight failed', { productId, normalizedUrl, error: String(err) })
  }
  const { data: competitor, error } = await admin
    .from('competitor_urls')
    .insert({
      product_id: productId,
      url: normalizedUrl,
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      last_price: initialPrice ?? null,
      last_price_currency: initialCurrency ? String(initialCurrency).toUpperCase() : null,
      last_checked_at: initialPrice ? new Date().toISOString() : null,
      match_confidence: matchConfidence,
      mismatch_reasons: mismatchReasons,
      preflight_signals: preflightSignals,
    })
    .select()
    .single()

  if (error) {
    console.error('[competitors/add] insert failed', { userId: user.id, productId, normalizedUrl, message: error.message, code: error.code })
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This competitor URL is already added for this product.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (initialPrice && competitor) {
    await admin.from('price_history').insert({ competitor_url_id: competitor.id, price: initialPrice })
  }

  return NextResponse.json({ competitor })
}
