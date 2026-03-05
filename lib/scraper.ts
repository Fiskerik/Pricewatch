/**
 * scraper.ts — Price scraper with Komplett/Cloudflare bypass
 *
 * Strategy:
 *  1. Direct fetch with full browser headers (works for most sites)
 *  2. ScraperAPI with JS rendering (handles Cloudflare + JS-rendered prices)
 *
 * Komplett.se specifics:
 *  - Product page HTML *does* contain price in og:price:amount meta tag
 *  - But Cloudflare 403s plain fetch → need realistic headers or ScraperAPI
 *  - Price is also in JSON-LD as "offers.price"
 */

export type CurrencyCode = string

const PRICE_SELECTORS = [
  // JSON-LD handled first (most reliable)
  'meta[property="og:price:amount"]',
  'meta[property="product:price:amount"]',
  '[itemprop="price"]',
  '[data-product-price]',
  '[data-price]',
  // Komplett / Nordic e-commerce
  '.product-price-now',
  '.product-price__value',
  '.product__price-now',
  '[class*="price-now"]',
  '[class*="priceNow"]',
  '[class*="PriceNow"]',
  '.product-price',
  // Shopify
  '.product__price',
  '.price__regular',
  '.price-item--regular',
  '[class*="product-price"]',
  // Generic
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
    .replace(/\u00a0/g, ' ')   // non-breaking space
    .replace(/\u202f/g, ' ')   // narrow no-break space (Komplett uses this: "1\u202f499")
    .replace(/\s+/g, '')
    .replace(/[^\d,\.]/g, '')

  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma > lastDot) {
    // European: 1.499,00 → 1499.00
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    // US: 1,499.00 → 1499.00
    normalized = normalized.replace(/,/g, '')
  }

  const parsed = parseFloat(normalized)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 1_000_000) return null
  return parsed
}

const SKIP_HINTS = ['shipping', 'frakt', 'delivery', 'rating', 'rabatt', 'discount', 'kvar', 'stock']

function looksLikeNonProductPrice(raw: string): boolean {
  const lowered = raw.toLowerCase()
  return SKIP_HINTS.some(t => lowered.includes(t))
}

// ---------------------------------------------------------------------------

async function extractPriceFromHtml(
  html: string,
  url: string,
): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  // Dynamic import of cheerio — only available server-side
  const { load } = await import('cheerio')
  const $ = load(html)

  // 1. JSON-LD (most reliable for most sites)
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
        const currency = offer?.priceCurrency ?? detectCurrency(raw, url)
        return { price: amount, scrapedCurrency: currency }
      }
    } catch { /* malformed */ }
  }

  // 2. og:price meta (Komplett does set these, just behind Cloudflare)
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
      const content =
        node.attr('content') ??
        node.attr('data-product-price') ??
        node.attr('data-price') ??
        node.text()
      const raw = content.trim()
      if (!raw || looksLikeNonProductPrice(raw)) continue
      const amount = parsePriceText(raw)
      if (!amount) continue
      return { price: amount, scrapedCurrency: detectCurrency(raw, url) }
    }
  }

  // 4. Regex last resort — find first plausible price in page
  const matches = Array.from(html.matchAll(
    /(?:price["\s:]+|"price":\s*)([\d]{1,3}(?:[\s.,\u00a0\u202f]\d{3})*(?:[.,]\d{2})?)/gi
  ))
  for (const match of matches) {
    if (looksLikeNonProductPrice(match[0])) continue
    const amount = parsePriceText(match[1])
    if (amount) return { price: amount, scrapedCurrency: detectCurrency(match[0], url) }
  }

  return { price: null, scrapedCurrency: null }
}

// ---------------------------------------------------------------------------

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Ch-Ua': '"Chromium";v="122", "Google Chrome";v="122"',
  'Upgrade-Insecure-Requests': '1',
}

async function scrapeDirectly(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: BROWSER_HEADERS,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

async function scrapeViaScraperApi(url: string) {
  if (!process.env.SCRAPER_API_KEY) throw new Error('No SCRAPER_API_KEY')

  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', process.env.SCRAPER_API_KEY)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')   // JS rendering — catches Vue/React prices
  apiUrl.searchParams.set('country_code', 'se') // Swedish IP — important for Nordic prices

  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(35_000) })
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

// ---------------------------------------------------------------------------

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'direct' | 'scraperapi' | 'failed'
  error?: string
}

export async function scrapePrice(url: string, targetCurrency?: CurrencyCode): Promise<ScrapeResult> {
  // Try direct first
  try {
    const result = await scrapeDirectly(url)
    if (result.price !== null) {
      return { ...result, scrapedCurrency: result.scrapedCurrency ?? targetCurrency ?? null, method: 'direct' }
    }
    // Got HTML but no price — fall through to ScraperAPI (JS rendering needed)
  } catch (err) {
    console.warn(`[scraper] direct failed for ${url}: ${String(err)}`)
  }

  // ScraperAPI fallback
  try {
    const result = await scrapeViaScraperApi(url)
    if (result.price !== null) {
      return { ...result, scrapedCurrency: result.scrapedCurrency ?? targetCurrency ?? null, method: 'scraperapi' }
    }
  } catch (err) {
    return { price: null, scrapedCurrency: null, method: 'failed', error: String(err) }
  }

  return { price: null, scrapedCurrency: null, method: 'failed', error: 'Price not found on page' }
}
