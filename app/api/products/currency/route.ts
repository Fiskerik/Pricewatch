import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { CurrencyCode, normalizeCurrencyCode } from '@/lib/currency'

const ratesCache = new Map<CurrencyCode, { expiresAt: number; rates: Record<string, number> }>()

async function getRates(base: CurrencyCode): Promise<Record<string, number>> {
  const now = Date.now()
  const cached = ratesCache.get(base)
  if (cached && cached.expiresAt > now) return cached.rates

  const apiKey = process.env.EXCHANGE_RATE_API_KEY

  if (apiKey) {
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/${base}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      throw new Error(`FX rate fetch failed (${res.status})`)
    }

    const payload = await res.json()
    if (payload?.result !== 'success' || !payload?.conversion_rates) {
      throw new Error(payload?.['error-type'] ? `FX error: ${payload['error-type']}` : 'FX response missing conversion_rates')
    }

    const rates = payload.conversion_rates as Record<string, number>
    ratesCache.set(base, { rates, expiresAt: now + 1000 * 60 * 15 })
    return rates
  }

  console.log('[products/currency] EXCHANGE_RATE_API_KEY missing, falling back to open.er-api.com')
  const fallbackRes = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })

  if (!fallbackRes.ok) {
    throw new Error(`Fallback FX rate fetch failed (${fallbackRes.status})`)
  }

  const fallbackPayload = await fallbackRes.json()
  if (!fallbackPayload?.rates) {
    throw new Error('Fallback FX response missing rates')
  }

  const fallbackRates = fallbackPayload.rates as Record<string, number>
  ratesCache.set(base, { rates: fallbackRates, expiresAt: now + 1000 * 60 * 15 })
  return fallbackRates
}

async function convertAmount(amount: number, from: CurrencyCode, to: CurrencyCode): Promise<number> {
  if (from === to) return amount
  const rates = await getRates(from)
  const rate = rates[to]
  if (!rate) {
    throw new Error(`Missing rate ${from}->${to}`)
  }
  return amount * rate
}

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

  const { data: competitorsSnapshot } = await supabase
    .from('competitor_urls')
    .select('id, last_price, last_price_currency')
    .eq('product_id', productId)

  let convertedOurPrice = product.our_price
  if (typeof product.our_price === 'number' && Number.isFinite(product.our_price) && currentProductCurrency !== normalizedCurrencyCode) {
    try {
      convertedOurPrice = await convertAmount(product.our_price, currentProductCurrency, normalizedCurrencyCode)
      console.log('[products/currency] converted product price', {
        productId,
        from: currentProductCurrency,
        to: normalizedCurrencyCode,
        original: product.our_price,
        converted: convertedOurPrice,
      })
    } catch (error) {
      console.log('[products/currency] product conversion failed', {
        productId,
        from: currentProductCurrency,
        to: normalizedCurrencyCode,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ error: 'Currency conversion failed for product price' }, { status: 502 })
    }
  }

  const convertedCompetitors = await Promise.all((competitorsSnapshot ?? []).map(async (comp) => {
    if (typeof comp.last_price !== 'number' || !Number.isFinite(comp.last_price)) {
      return comp
    }

    const originCurrency = normalizeCurrencyCode(comp.last_price_currency || currentProductCurrency, currentProductCurrency)

    if (originCurrency === normalizedCurrencyCode) {
      return {
        ...comp,
        last_price_currency: normalizedCurrencyCode,
      }
    }

    try {
      const converted = await convertAmount(comp.last_price, originCurrency, normalizedCurrencyCode)
      return {
        ...comp,
        last_price: converted,
        last_price_currency: normalizedCurrencyCode,
      }
    } catch (error) {
      console.log('[products/currency] competitor conversion failed', {
        productId,
        competitorId: comp.id,
        from: originCurrency,
        to: normalizedCurrencyCode,
        error: error instanceof Error ? error.message : String(error),
      })
      return comp
    }
  }))

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

  return NextResponse.json({ product: data, competitors: convertedCompetitors })
}
