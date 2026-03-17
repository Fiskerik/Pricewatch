import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import * as cheerio from 'cheerio'
import { scrapePrice } from '@/lib/scraper'
 
interface DiscoveryCandidate {
  url: string
  label: string
  price: number | null
  currency: string | null
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown'
  confidence: number
  domain: string
}
 
const BLOCKED_HOSTS = new Set([
  'google.com', 'www.google.com', 'shopping.google.com',
  'webcache.googleusercontent.com', 'duckduckgo.com', 'www.duckduckgo.com',
  'bing.com', 'www.bing.com',
])
 
// Domains that are NOT shopping sites (forums, blogs, review sites)
const NON_SHOPPING_DOMAINS = new Set([
  'reddit.com', 'quora.com', 'stackoverflow.com', 'medium.com',
  'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'trustpilot.com', 'yelp.com', 'tripadvisor.com',
  'wikipedia.org', 'wikihow.com',
  'flashback.org', 'familjeliv.se', 'sweclockers.com',
])
 
function isNonShoppingSite(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    
    // Check against known non-shopping domains
    if (NON_SHOPPING_DOMAINS.has(hostname)) return true
    
    // Check for forum/blog patterns in the URL
    if (/\/(forum|forums|community|blog|review|thread|post|discussion)\//i.test(url)) return true
    
    return false
  } catch {
    return false
  }
}
 
function normalizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    parsed.pathname = normalizedPath || '/'
    return parsed.toString()
  } catch {
    return null
  }
}
 
function extractDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Competitor'
  }
}
 
function decodeGoogleHref(href: string): string | null {
  if (!href) return null
  if (href.startsWith('/url?')) {
    const urlParams = new URLSearchParams(href.slice('/url?'.length))
    return urlParams.get('q')
  }
  return href
}
 
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  return res.text()
}
 
function pushCandidate(
  candidates: Array<{ url: string; label: string }>,
  rawUrl: string | null | undefined,
  label: string
) {
  if (!rawUrl) return
  const normalized = normalizeUrl(rawUrl)
  if (!normalized) return
 
  let host = ''
  try {
    host = new URL(normalized).hostname.replace(/^www\./, '')
  } catch {
    return
  }
 
  if (BLOCKED_HOSTS.has(host)) return
  if (isNonShoppingSite(normalized)) {
    console.log('[competitors/discover] skipping non-shopping site', { url: normalized, host })
    return
  }
  if (candidates.some(c => c.url === normalized)) return
 
  candidates.push({
    url: normalized,
    label: label.trim() || extractDomainLabel(normalized),
  })
}
 
async function discoverFromGoogleShopping(title: string): Promise<Array<{ url: string; label: string }>> {
  const query = encodeURIComponent(`${title} buy`)
  const html = await fetchHtml(`https://www.google.com/search?tbm=shop&q=${query}`)
  const $ = cheerio.load(html)
  const candidates: Array<{ url: string; label: string }> = []
 
  console.log('[competitors/discover] google shopping response', {
    htmlLength: html.length,
    hasCaptcha: /captcha|detected unusual traffic/i.test(html),
    hasConsentGate: /consent\.google|before you continue/i.test(html),
  })
 
  // Try multiple selectors for Google Shopping results
  const selectors = [
    'div[data-sh-card]',           // Shopping card container
    'div[data-sh-pr]',             // Product result
    'div.sh-dgr__content',         // Shopping grid content
    'div.sh-dlr__list-result',     // Shopping list result
    'a.shntl',                     // Shopping link
  ]
 
  for (const selector of selectors) {
    $(selector).each((_, card) => {
      const $card = $(card)
      
      // Try to find the product link
      const $link = $card.find('a[href^="/url?"], a[href^="http"]').first()
      if (!$link.length) return
      
      const href = $link.attr('href') ?? ''
      const decodedHref = decodeGoogleHref(href)
      
      // Try to find product title
      const text = $card.find('h3, h4, [role="heading"], .tAxDx').first().text() || 
                   $card.find('[data-sh-product-name]').text() ||
                   $link.text()
      
      if (decodedHref && text) {
        pushCandidate(candidates, decodedHref, text)
      }
    })
    
    if (candidates.length > 0) {
      console.log('[competitors/discover] found results with selector', { selector, count: candidates.length })
      break
    }
  }
 
  // If structured selectors didn't work, try extracting shopping links more broadly
  if (candidates.length === 0) {
    $('a[href^="/url?"]').each((_, element) => {
      const href = $(element).attr('href') ?? ''
      const decodedHref = decodeGoogleHref(href)
      const text = $(element).find('h3, h4').first().text() || $(element).text()
      
      if (decodedHref && text && !isNonShoppingSite(decodedHref)) {
        pushCandidate(candidates, decodedHref, text)
      }
    })
  }
 
  console.log('[competitors/discover] google shopping final count', { candidates: candidates.length })
  return candidates
}
 
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
  const body = await req.json()
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const targetCurrency = typeof body?.currency === 'string' ? body.currency : 'USD'
  const limit = typeof body?.limit === 'number' ? Math.max(1, Math.min(15, Math.trunc(body.limit))) : 10
 
  if (!productId || !title) {
    return NextResponse.json({ error: 'Missing productId or title' }, { status: 400 })
  }
 
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, stores!inner(user_id)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()
 
  if (productError || !product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
 
  const { data: existingCompetitors } = await supabase
    .from('competitor_urls')
    .select('url')
    .eq('product_id', productId)
 
  const existingUrls = new Set(
    (existingCompetitors ?? [])
      .map((entry: { url?: string | null }) => normalizeUrl(entry.url ?? ''))
      .filter((value): value is string => Boolean(value))
  )
 
  // Discover URLs from Google Shopping only
  let allUrlCandidates: Array<{ url: string; label: string }> = []
 
  try {
    const googleCandidates = await discoverFromGoogleShopping(title)
    console.log('[competitors/discover] google shopping candidates', { productId, count: googleCandidates.length })
    allUrlCandidates.push(...googleCandidates)
  } catch (error) {
    console.log('[competitors/discover] google shopping discovery failed', { productId, error: String(error) })
    return NextResponse.json({ error: 'Failed to discover competitors. Google Shopping may be temporarily unavailable.' }, { status: 500 })
  }
 
  const dedupedCandidates = Array.from(new Map(allUrlCandidates.map(candidate => [candidate.url, candidate])).values())
 
  // Filter out existing competitors
  const newUrlCandidates = dedupedCandidates
    .filter(c => !existingUrls.has(c.url))
    .slice(0, limit * 2) // Get extras for filtering
 
  if (newUrlCandidates.length === 0) {
    console.log('[competitors/discover] no new candidates after filtering', { productId, totalFound: dedupedCandidates.length })
    return NextResponse.json({ candidates: [] })
  }
 
  // Scrape prices and check availability
  const enrichedCandidates: DiscoveryCandidate[] = []
 
  for (const candidate of newUrlCandidates) {
    try {
      const scrapeResult = await scrapePrice(candidate.url, targetCurrency)
      
      const isOutOfStock = scrapeResult.stockStatus === 'out_of_stock'
      
      // Calculate confidence score
      let confidence = 0.5
      if (scrapeResult.price !== null) confidence += 0.3
      if (!isOutOfStock) confidence += 0.2
      if (scrapeResult.stockStatus !== 'unknown') confidence += 0.1
      
      enrichedCandidates.push({
        url: candidate.url,
        label: candidate.label,
        price: scrapeResult.price,
        currency: scrapeResult.scrapedCurrency,
        stockStatus: scrapeResult.stockStatus,
        confidence,
        domain: extractDomainLabel(candidate.url),
      })
    } catch (error) {
      console.log('[competitors/discover] scrape failed', { url: candidate.url, error: String(error) })
      // Still add it so users can review manually
      enrichedCandidates.push({
        url: candidate.url,
        label: candidate.label,
        price: null,
        currency: null,
        stockStatus: 'unknown',
        confidence: 0.2,
        domain: extractDomainLabel(candidate.url),
      })
    }
  }
 
  // Filter and rank
  const filtered = enrichedCandidates
    .filter(c => c.stockStatus !== 'out_of_stock')
    .sort((a, b) => {
      if (a.price !== null && b.price === null) return -1
      if (a.price === null && b.price !== null) return 1
      if (a.price !== null && b.price !== null) return a.price - b.price
      return b.confidence - a.confidence
    })
    .slice(0, limit)
 
  console.log('[competitors/discover] returning candidates for manual selection', {
    productId,
    requestedTitle: title,
    scrapedCount: enrichedCandidates.length,
    returnedCount: filtered.length,
  })
 
  return NextResponse.json({ candidates: filtered })
}
 
