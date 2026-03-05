import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { scrapePrice } from '@/lib/scraper'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId } = await req.json()
  if (!competitorId) return NextResponse.json({ error: 'competitorId required' }, { status: 400 })

  const { data: competitorWithOwner } = await supabase
    .from('competitor_urls')
    .select('id, url, last_price, products!inner(id, currency_code, stores!inner(user_id))')
    .eq('id', competitorId)
    .eq('products.stores.user_id', user.id)
    .single()

  if (!competitorWithOwner) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  try {
    const targetCurrency = (competitorWithOwner as any)?.products?.currency_code ?? 'USD'
    const result = await scrapePrice(competitorWithOwner.url, targetCurrency)
    const updatePayload: Record<string, unknown> = {
      last_checked_at: now,
    }

    if (result.price !== null) {
      updatePayload.last_price = result.price

      const oldPrice = competitorWithOwner.last_price ? Number(competitorWithOwner.last_price) : null
      if (oldPrice !== null && Math.abs(result.price - oldPrice) > 0.005) {
        updatePayload.last_changed_at = now
      }
    }

    const { data: competitor, error } = await supabase
      .from('competitor_urls')
      .update(updatePayload)
      .eq('id', competitorId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (result.price !== null) {
      await supabase.from('price_history').insert({
        competitor_url_id: competitorId,
        price: result.price,
        checked_at: now,
      })
    }

    return NextResponse.json({ competitor, scrape: result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
