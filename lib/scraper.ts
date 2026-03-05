/**
 * scraper.ts — Price scraper with per-domain strategies
 *
 * Problem sites:
 *  - power.se   → Next.js SSR, price in JS bundle / internal API
 *  - komplett.se → Cloudflare + JS-rendered price
 *  - Most Nordic retailers → similar pattern
 *
 * Strategy per site:
 *  1. Domain-specific API handler (fastest, most reliable)
 *  2. Direct fetch with browser headers + HTML parsing
 *  3. ScraperAPI with JS rendering (fallback, handles everything)
 */

export type CurrencyCode = string

// ─────────────────────────────────────────────────────────────
// HTML price extraction helpers
// ─────────────────────────────────────────────────────────────

const PRICE_SELECTORS = [
  'meta[property="og:price:amount"]',
  'meta[property="product:price:amount"]',
  '[itemprop="price"]',
  '[data-product-price]',
  '[data-price]',
  '.product-price-now',
  '.product-price__value',
  '.product__price-now',
  '[class*="price-now"]',
  '[class*="priceNow"]',
  '[class*="PriceNow"]',
  '.product-price',
  '.product__price',
  '.price__regular',
  '.price-item--regular',
  '[class*="product-price"]',
  'span.price',
  '.price',
  '[class*="price"]',
  '[id*="price"]',
]

const CURRENCY_SYMBOL_MAP: Record<string, CurrencyCode> = {
  '$': 'USD', '€': 'EUR', '£': 'GBP',
  'kr': 'SEK', 'sek': 'SEK', 'nok': 'NOK', 'dkk': 'DKK',
  'cad': 'CAD', 'aud': 'AUD', 'jpy': 'JPY', '¥': 'JPY',
}

const DOMAIN_CURRENCY_HINTS: Record<string, CurrencyCode> = {
  '.se': 'SEK', '.no': 'NOK', '.dk': 'DKK',
  '.co.uk': 'GBP', '.uk': 'GBP', '.eu': 'EUR',
}

function detectCurrency(raw: string, url: string): CurrencyCode {
  const lowered = raw.toLowerCase()
  for (const [token, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (lowered.includes(token)) return code
  }
  try {
    const host = new URL(url).hostname.toLowerCase()
    for (const [suffix, code] of Object.entries(DOMAIN_CURRENCY_HINTS)) {
      if (host.endsWith(suffix)) return code
    }
  } catch { /* ignore */ }
  return 'USD'
}

function parsePriceText(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\u202f/g, ' ')   // narrow no-break space (used by Komplett, Power)
    .replace(/\s+/g, '')
    .replace(/[^\d,\.]/g, '')

  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = normalized.replace(/,/g, '')
  }

  const parsed = parseFloat(normalized)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 1_000_000) return null
  return parsed
}

const SKIP_HINTS = ['shipping', 'frakt', 'delivery', 'rating', 'rabatt', 'discount', 'kvar', 'stock']
function looksLikeNonProductPrice(raw: string): boolean {
  return SKIP_HINTS.some(t => raw.toLowerCase().includes(t))
}

async function extractPriceFromHtml(
  html: string,
  url: string,
): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  const { load } = await import('cheerio')
  const $ = load(html)

  // 1. JSON-LD
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const raw = $(script).contents().text()
      const parsed = JSON.parse(raw)
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of candidates) {
        const offerRaw = item?.offers
        const offer = offerRaw?.price != null ? offerRaw : Array.isArray(offerRaw) ? offerRaw[0] : null
        const amount = offer?.price != null ? parseFloat(String(offer.price)) : null
        if (!amount || Number.isNaN(amount) || amount <= 0) continue
        return { price: amount, scrapedCurrency: offer?.priceCurrency ?? detectCurrency(raw, url) }
      }
    } catch { /* malformed */ }
  }

  // 2. og/product meta price
  const ogPrice = $('meta[property="og:price:amount"]').attr('content')
    ?? $('meta[property="product:price:amount"]').attr('content')
  const ogCurrency = $('meta[property="og:price:currency"]').attr('content')
    ?? $('meta[property="product:price:currency"]').attr('content')
  if (ogPrice) {
    const amount = parseFloat(ogPrice.replace(/[^0-9.]/g, ''))
    if (!isNaN(amount) && amount > 0) {
      return { price: amount, scrapedCurrency: ogCurrency ?? detectCurrency('', url) }
    }
  }

  // 3. CSS selectors
  for (const selector of PRICE_SELECTORS) {
    for (const el of $(selector).toArray()) {
      const node = $(el)
      const content = node.attr('content') ?? node.attr('data-product-price') ?? node.attr('data-price') ?? node.text()
      const raw = content.trim()
      if (!raw || looksLikeNonProductPrice(raw)) continue
      const amount = parsePriceText(raw)
      if (!amount) continue
      return { price: amount, scrapedCurrency: detectCurrency(raw, url) }
    }
  }

  // 4. JSON blob in __NEXT_DATA__ or window.__INITIAL_STATE__ etc
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextData) {
    try {
      const json = JSON.parse(nextData[1])
      const str = JSON.stringify(json)
      // Look for price fields
      const priceMatch = str.match(/"(?:price|currentPrice|salesPrice|priceIncVat|priceExVat|listPrice)":\s*([\d]+(?:\.\d+)?)/i)
      if (priceMatch) {
        const amount = parseFloat(priceMatch[1])
        if (!isNaN(amount) && amount > 0) {
          return { price: amount, scrapedCurrency: detectCurrency('', url) }
        }
      }
    } catch { /* malformed */ }
  }

  // 5. Regex over price-like JSON values in script tags
  const scriptPriceMatch = html.match(/"(?:price|currentPrice|salesPrice|priceIncVat)":\s*([\d]{2,7}(?:\.\d{1,2})?)/i)
  if (scriptPriceMatch) {
    const amount = parseFloat(scriptPriceMatch[1])
    if (!isNaN(amount) && amount > 0) {
      return { price: amount, scrapedCurrency: detectCurrency('', url) }
    }
  }

  return { price: null, scrapedCurrency: null }
}

// ─────────────────────────────────────────────────────────────
// Domain-specific handlers — hit internal APIs directly
// ─────────────────────────────────────────────────────────────

/**
 * power.se internal product API
 * Product pages: /.../.../p-{ID}/
 * Internal API:  /api/products/{ID}  (returns JSON with price)
 */
async function scrapePowerSe(url: string): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  // Extract product ID: p-4125288
  const idMatch = url.match(/\/(p-\d+)\/?/i)
  if (!idMatch) throw new Error('Could not extract product ID from power.se URL')

  const productId = idMatch[1].replace('p-', '') // → "4125288"
  const apiUrl = `https://www.power.se/api/products/${productId}`

  const res = await fetch(apiUrl, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://www.power.se/',
    },
  })

  if (!res.ok) throw new Error(`power.se API HTTP ${res.status}`)

  const data = await res.json()

  // Try multiple known price field names in their API response
  const priceFields = [
    data?.price,
    data?.currentPrice,
    data?.salesPrice,
    data?.priceIncVat,
    data?.product?.price,
    data?.product?.currentPrice,
    data?.product?.priceIncVat,
    data?.data?.price,
    data?.data?.currentPrice,
  ]

  for (const field of priceFields) {
    if (field != null) {
      const amount = parseFloat(String(field))
      if (!isNaN(amount) && amount > 0) {
        return { price: amount, scrapedCurrency: 'SEK' }
      }
    }
  }

  // Fallback: stringify and regex-search the JSON
  const str = JSON.stringify(data)
  const match = str.match(/"(?:price|currentPrice|salesPrice|priceIncVat)":\s*([\d]{2,7}(?:\.\d{1,2})?)/i)
  if (match) {
    const amount = parseFloat(match[1])
    if (!isNaN(amount) && amount > 0) {
      return { price: amount, scrapedCurrency: 'SEK' }
    }
  }

  throw new Error('Price not found in power.se API response')
}

/**
 * komplett.se — Cloudflare protected, try direct with browser headers first
 * Their price is in og:price:amount AND JSON-LD — both work once we get past CF
 */
async function scrapeKomplettSe(url: string): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  // komplett.se does respond to direct fetch with correct headers (no JS needed for price)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'sv-SE,sv;q=0.9',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  })
  if (!res.ok) throw new Error(`komplett.se HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

// ─────────────────────────────────────────────────────────────
// Generic strategies
// ─────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

async function scrapeDirectly(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: BROWSER_HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  // If page body is basically empty (JS-rendered), don't waste time parsing
  if (html.length < 5000 && !html.includes('price')) throw new Error('Empty/JS-only page')
  return extractPriceFromHtml(html, url)
}

async function scrapeViaScraperApi(url: string) {
  if (!process.env.SCRAPER_API_KEY) throw new Error('No SCRAPER_API_KEY configured')

  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', process.env.SCRAPER_API_KEY)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')
  apiUrl.searchParams.set('country_code', 'se')

  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(35_000) })
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'domain-api' | 'direct' | 'scraperapi' | 'failed'
  error?: string
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// targetCurrency is accepted for API compatibility but currency is auto-detected from the page/domain
export async function scrapePrice(url: string, targetCurrency?: string): Promise<ScrapeResult> {
  const domain = getDomain(url)

  // ── Step 1: domain-specific fast path ──
  try {
    if (domain === 'power.se') {
      const result = await scrapePowerSe(url)
      if (result.price !== null) return { ...result, method: 'domain-api' }
    }
    if (domain === 'komplett.se') {
      const result = await scrapeKomplettSe(url)
      if (result.price !== null) return { ...result, method: 'direct' }
    }
  } catch (err) {
    console.warn(`[scraper] domain handler failed for ${domain}: ${String(err)}`)
  }

  // ── Step 2: generic direct fetch ──
  try {
    const result = await scrapeDirectly(url)
    if (result.price !== null) return { ...result, method: 'direct' }
  } catch (err) {
    console.warn(`[scraper] direct failed for ${url}: ${String(err)}`)
  }

  // ── Step 3: ScraperAPI with JS rendering ──
  try {
    const result = await scrapeViaScraperApi(url)
    if (result.price !== null) return { ...result, method: 'scraperapi' }
  } catch (err) {
    return { price: null, scrapedCurrency: null, method: 'failed', error: String(err) }
  }

  return { price: null, scrapedCurrency: null, method: 'failed', error: 'Price not found on page' }
}
