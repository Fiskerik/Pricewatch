import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { convertCurrency, normalizeCurrencyCode } from '@/lib/currency'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productId, currencyCode } = await req.json()
  if (!productId || !currencyCode) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const normalizedCurrencyCode = normalizeCurrencyCode(currencyCode)

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, store_id, currency_code, our_price')
    .eq('id', productId)
    .single()

  if (productError) {
    console.log('[products/currency] failed loading product', { productId, userId: user.id, error: productError.message })
  }

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id')
    .eq('id', product.store_id)
    .eq('user_id', user.id)
    .single()

  if (storeError) {
    console.log('[products/currency] failed loading store ownership', { productId, userId: user.id, error: storeError.message })
  }

  if (!store) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const currentProductCurrency = normalizeCurrencyCode(product.currency_code, 'USD')

  const convertCache = new Map<string, number>()
  const convertPrice = async (amount: number, fromRaw: string, toRaw: string) => {
    const from = normalizeCurrencyCode(fromRaw)
    const to = normalizeCurrencyCode(toRaw)
    if (from === to) return amount
    const key = `${from}->${to}->${amount}`
    if (convertCache.has(key)) return convertCache.get(key)!
    const converted = await convertCurrency(amount, from, to)
    convertCache.set(key, converted)
    return converted
  }

  let convertedOurPrice: number | null = product.our_price
  if (typeof product.our_price === 'number' && Number.isFinite(product.our_price)) {
    convertedOurPrice = await convertPrice(product.our_price, currentProductCurrency, normalizedCurrencyCode)
  }

  const { data: competitors, error: competitorsError } = await supabase
    .from('competitor_urls')
    .select('id, last_price, last_price_currency')
    .eq('product_id', productId)

  if (competitorsError) {
    console.log('[products/currency] failed loading competitors', { productId, userId: user.id, error: competitorsError.message })
  }

  for (const competitor of competitors ?? []) {
    if (typeof competitor.last_price !== 'number' || !Number.isFinite(competitor.last_price)) continue
    const sourceCurrency = normalizeCurrencyCode(competitor.last_price_currency, currentProductCurrency)
    const convertedPrice = await convertPrice(competitor.last_price, sourceCurrency, normalizedCurrencyCode)
    await supabase
      .from('competitor_urls')
      .update({ last_price: convertedPrice, last_price_currency: normalizedCurrencyCode })
      .eq('id', competitor.id)

    const { data: historyRows } = await supabase
      .from('price_history')
      .select('id, price')
      .eq('competitor_url_id', competitor.id)

    for (const row of historyRows ?? []) {
      if (typeof row.price !== 'number' || !Number.isFinite(row.price)) continue
      const convertedHistoryPrice = await convertPrice(row.price, sourceCurrency, normalizedCurrencyCode)
      await supabase.from('price_history').update({ price: convertedHistoryPrice }).eq('id', row.id)
    }
  }

  const { data: convertedCompetitors } = await supabase
    .from('competitor_urls')
    .select('id, last_price, last_price_currency')
    .eq('product_id', productId)

  const { data, error } = await supabase
    .from('products')
    .update({ currency_code: normalizedCurrencyCode, our_price: convertedOurPrice })
    .eq('id', productId)
    .select('id, currency_code, our_price')
    .single()

  if (error) {
    console.log('[products/currency] update failed', { productId, userId: user.id, currencyCode: normalizedCurrencyCode, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ product: data, competitors: convertedCompetitors ?? [] })
}
