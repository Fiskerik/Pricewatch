import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { cleanUrl } from '@/lib/scraper'
import { evaluateCompetitorMatch, runCompetitorPreflight } from '@/lib/competitorMatch'
import { getPlanUsageStatus } from '@/lib/planLimits'

// ── Tracking params to strip from any URL ───────────────────────────────────
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gad_source', 'msclkid', 'pjclid',
  'ref', 'source', '_ga', '_gl', 'mc_cid', 'mc_eid', 'affiliate',
]

// ── Robust URL normalizer ────────────────────────────────────────────────────
// Accepts messy user input: missing protocol, HTML entities, surrounding
// quotes, tracking params, mixed text with an embedded URL, etc.
function normalizeCompetitorUrl(rawInput: string): string {
  if (!rawInput || typeof rawInput !== 'string') {
    throw new Error('No URL provided')
  }

  let input = rawInput.trim()

  // 1. Strip surrounding quotes or backticks (common from copy-paste)
  input = input.replace(/^["'`]+|["'`]+$/g, '').trim()

  // 2. Decode common HTML entities (&amp; → &, &#nnn; → char, etc.)
  input = input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

  // 3. If the string contains spaces, try to extract an embedded URL first
  //    before giving up (handles "Buy here: https://shop.com/product").
  if (input.includes(' ')) {
    const embeddedUrl = input.match(/https?:\/\/[^\s"'<>()[\]{}\\]+/i)
    if (embeddedUrl) {
      input = embeddedUrl[0]
    } else {
      // No embedded URL — collapse spaces as a last resort (encoded spaces)
      input = input.replace(/\s+/g, '%20')
    }
  }

  // 4. Handle protocol-relative URLs (//example.com/path)
  if (input.startsWith('//')) {
    input = 'https:' + input
  }

  // 5. Auto-prepend https:// when the protocol is missing entirely
  if (!/^https?:\/\//i.test(input)) {
    // Looks like a bare domain or domain/path — add the protocol
    if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(input)) {
      input = 'https://' + input
    } else {
      throw new Error('Not a recognisable URL — please paste a link that starts with https://')
    }
  }

  // 6. Parse and hard-validate
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('Could not parse as a URL — please paste a full product page link')
  }

  // 7. Only http / https are valid for scraping
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported')
  }

  // 8. Must have a real hostname with at least one dot
  if (!parsed.hostname || !parsed.hostname.includes('.') || parsed.hostname.length < 4) {
    throw new Error('URL does not appear to be a valid website address')
  }

  // 9. Strip the fragment — useless for price tracking
  parsed.hash = ''

  // 10. Strip all known tracking query parameters
  TRACKING_PARAMS.forEach(p => parsed.searchParams.delete(p))

  // 11. Normalize path — strip trailing slashes but keep root /
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid URL'
    console.log('[competitors/add] URL normalization failed', {
      rawUrl: url,
      error: String(err),
    })
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { data: product } = await supabase
    .from('products')
    .select('*, competitor_urls(id), stores!inner(user_id, plan)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: storeProducts, error: storeProductsError } = await supabase
    .from('products')
    .select('id, competitor_urls(id)')
    .eq('store_id', (product as any).store_id)

  if (storeProductsError) {
    console.log('[competitors/add] failed loading store products for plan validation', {
      productId,
      storeId: (product as any).store_id,
      error: storeProductsError.message,
    })
    return NextResponse.json({ error: 'Failed to validate your plan limits.' }, { status: 500 })
  }

  const usage = getPlanUsageStatus((product as any)?.stores?.plan, (storeProducts ?? []) as any)

  if (usage.isPaused) {
    return NextResponse.json({
      error: 'Your current plan is below your saved usage. Tracking is paused, and you can only delete products or competitors until you are back within your tier limits.',
    }, { status: 409 })
  }

  if (usage.competitorLimit !== Infinity && ((product as any)?.competitor_urls?.length ?? 0) >= usage.competitorLimit) {
    return NextResponse.json({ error: `Your ${usage.plan} plan allows up to ${usage.competitorLimit} competitors per product.` }, { status: 409 })
  }

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
      is_active: true,
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
    })
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'This competitor URL is already added for this product.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (initialPrice && competitor) {
    await admin.from('price_history').insert({ competitor_url_id: competitor.id, price: initialPrice })
  }

  return NextResponse.json({ competitor })
}
