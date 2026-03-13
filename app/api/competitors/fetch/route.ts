import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { scrapePrice } from '@/lib/scraper'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId, preferredMetric } = await req.json()
  if (!competitorId) return NextResponse.json({ error: 'Missing competitorId' }, { status: 400 })

  const { data: competitor, error: fetchError } = await supabase
    .from('competitor_urls')
    .select('*, products(currency_code, store_id)')
    .eq('id', competitorId)
    .single()

  if (fetchError || !competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', (competitor as any).products?.store_id)
    .eq('user_id', user.id)
    .single()

  if (!store) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targetCurrency = (competitor as any)?.products?.currency_code ?? 'USD'
  const now = new Date().toISOString()
  const savedMetric = (competitor as any)?.selected_price_metric ?? (typeof preferredMetric === 'string' ? preferredMetric : null)
  const result = await scrapePrice(competitor.url, targetCurrency, { preferredMetric: savedMetric })

  console.log('[competitors/fetch]', {
    competitorId,
    url: competitor.url,
    price: result.price,
    currency: result.scrapedCurrency,
    method: result.method,
    error: result.error,
    metricUsed: result.metricUsed,
    preferredMetric: savedMetric,
    matchedPreferredMetric: result.matchedPreferredMetric,
    candidateCount: result.candidates.length,
  })

  const updatePayload: Record<string, unknown> = { last_checked_at: now }

  if (result.price !== null) {
    const previousPrice = competitor.last_price
    updatePayload.last_price = result.price
    updatePayload.last_price_currency = result.scrapedCurrency ?? targetCurrency
    if (previousPrice !== null && previousPrice !== result.price) {
      updatePayload.last_changed_at = now
      updatePayload.previous_price = previousPrice
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('competitor_urls')
    .update(updatePayload)
    .eq('id', competitorId)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update competitor' }, { status: 500 })
  }

  return NextResponse.json({
    competitor: updated,
    scrapedPrice: result.price,
    scrapedCurrency: result.scrapedCurrency,
    scrapeMethod: result.method,
    scrapeError: result.error ?? null,
    candidates: result.candidates,
    metricUsed: result.metricUsed,
    matchedPreferredMetric: result.matchedPreferredMetric,
  })
}
