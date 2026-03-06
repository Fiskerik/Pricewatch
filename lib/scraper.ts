export type CurrencyCode = string

// ─── Price text parsing ───────────────────────────────────────────────────────

function parsePriceText(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')   // non-breaking space
    .replace(/\u202f/g, ' ')   // narrow no-break space
    .replace(/\s+/g, '')
    .replace(/[^\d,\.]/g, '')

  if (!cleaned || cleaned.length < 1) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot   = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma > lastDot) {
    // European: 28.989,05 or 1.499 → strip dots, comma becomes decimal
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    // US/UK: 28,989.05 → strip commas
    normalized = normalized.replace(/,/g, '')
  }

  const n = parseFloat(normalized)
  if (Number.isNaN(n) || n <= 0 || n > 10_000_000) return null
  return n
}

const CURRENCY_SYMBOL_MAP: Record<string, CurrencyCode> = {
  '$': 'USD', '€': 'EUR', '£': 'GBP',
  'kr': 'SEK', 'sek': 'SEK', 'nok': 'NOK', 'dkk': 'DKK',
  'cad': 'CAD', 'aud': 'AUD', 'jpy': 'JPY', '¥': 'JPY',
}

const DOMAIN_CURRENCY: Record<string, CurrencyCode> = {
  '.se': 'SEK', '.no': 'NOK', '.dk': 'DKK', '.fi': 'EUR',
  '.co.uk': 'GBP', '.uk': 'GBP', '.eu': 'EUR',
}

function detectCurrency(raw: string, url: string): CurrencyCode {
  const lowered = raw.toLowerCase()
  for (const [token, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (lowered.includes(token)) return code
  }
  try {
    const host = new URL(url).hostname.toLowerCase()
    for (const [suffix, code] of Object.entries(DOMAIN_CURRENCY)) {
      if (host.endsWith(suffix)) return code
    }
    if (host.includes('etsy.com')) {
      if (url.includes('/fi-')) return 'EUR'
      if (url.includes('/se-')) return 'SEK'
      if (url.includes('/no-')) return 'NOK'
      if (url.includes('/dk-')) return 'DKK'
      if (url.includes('/uk-') || url.includes('/gb-')) return 'GBP'
      return 'EUR'
    }
  } catch { /* ignore */ }
  return 'USD'
}

const SKIP_TEXT = ['shipping', 'frakt', 'delivery', 'rating', 'rabatt', 'discount', 'kvar', 'stock', 'recensioner', 'betyg']

function isNonProductPrice(raw: string): boolean {
  return SKIP_TEXT.some(t => raw.toLowerCase().includes(t))
}

// ─── HTML price extraction ────────────────────────────────────────────────────

const PRICE_SELECTORS = [
  '[itemprop="price"]',
  '[data-product-price]', '[data-price]', '[data-testid*="price"]',
  '.product-price-now', '.product-price__value', '.product__price-now',
  '[class*="price-now"]', '[class*="priceNow"]', '[class*="PriceNow"]',
  '[class*="currentPrice"]', '[class*="salesPrice"]',
  '.product__price', '.price__regular', '.price-item--regular',
  '[class*="product-price"]',
  'span.price', '.price', '[class*="price"]', '[id*="price"]',
  '.wt-text-title-03', // Etsy specific price selector
]

async function extractFromHtml(
  html: string,
  url: string,
): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {

  const etsyHostCheck = (() => { try { return new URL(url).hostname.includes('etsy.com') } catch { return false } })()
  
  // ── Optimized Etsy/General JSON-LD extraction ────────────────
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1])
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        if ((item?.['@type'] === 'Product' || item?.offers)) {
          const offers = item.offers
          if (offers) {
            // AggregateOffer (Price range)
            if (offers['@type'] === 'AggregateOffer') {
              const low = offers.lowPrice ?? offers.price
              const currency = offers.priceCurrency ?? offers.lowPriceCurrency
              if (low != null) {
                const amount = parseFloat(String(low))
                if (!isNaN(amount) && amount > 0) return { price: amount, scrapedCurrency: currency || 'EUR' }
              }
            }
            // Single Offer
            if (offers.price != null) {
              const amount = parseFloat(String(offers.price))
              if (!isNaN(amount) && amount > 0) return { price: amount, scrapedCurrency: offers.priceCurrency || 'EUR' }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ── Meta tags (og:price:amount) ───────────────────────────
  const ogPriceMatch = html.match(/<meta[^>]+property="(?:og|product|price):price:amount"[^>]+content="([^"]+)"/i)
  const ogCurrMatch  = html.match(/<meta[^>]+property="(?:og|product|price):price:currency"[^>]+content="([^"]+)"/i)
  if (ogPriceMatch) {
    const amount = parseFloat(ogPriceMatch[1].replace(/[^0-9.]/g, ''))
    if (!isNaN(amount) && amount > 0) {
      return { price: amount, scrapedCurrency: ogCurrMatch?.[1] ?? detectCurrency('', url) }
    }
  }

  // ── CSS selectors via cheerio ───────────────────────
  try {
    const { load } = await import('cheerio')
    const $ = load(html)
    for (const selector of PRICE_SELECTORS) {
      for (const el of $(selector).toArray()) {
        const node = $(el)
        const content = node.attr('content') ?? node.attr('data-product-price')
          ?? node.attr('data-price') ?? node.text()
        const raw = content.trim()
        if (!raw || isNonProductPrice(raw)) continue
        const amount = parsePriceText(raw)
        if (amount) return { price: amount, scrapedCurrency: detectCurrency(raw, url) }
      }
    }
  } catch { /* ignore */ }

  return { price: null, scrapedCurrency: null }
}

// ─── Rendering services ───────────────────────────────────────────────────────

async function renderWithScraperApi(url: string): Promise<string> {
  const key = process.env.SCRAPER_API_KEY
  if (!key) throw new Error('SCRAPER_API_KEY not set')

  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')
  apiUrl.searchParams.set('premium', 'true') // Essential for Etsy
  apiUrl.searchParams.set('wait_for_selector', '.wt-text-title-03')

  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`ScraperAPI ${res.status}`)
  return res.text()
}

async function renderWithBrowserless(url: string): Promise<string> {
  const key = process.env.BROWSERLESS_API_KEY
  const body = JSON.stringify({
    url,
    waitFor: 7000, // Increased for Etsy
    gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
    setExtraHTTPHeaders: { 'Accept-Language': 'sv-SE,sv;q=0.9' },
  })

  const res = await fetch(`https://production-sfo.browserless.io/content?token=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return res.text()
}

async function renderJs(url: string): Promise<string> {
  const providers = [
    { name: 'ScraperAPI', fn: renderWithScraperApi, key: process.env.SCRAPER_API_KEY },
    { name: 'Browserless', fn: renderWithBrowserless, key: process.env.BROWSERLESS_API_KEY },
  ]

  const configured = providers.filter(p => p.key)
  for (const provider of configured) {
    try {
      return await provider.fn(url)
    } catch (err) {
      console.warn(`[scraper] ${provider.name} failed: ${err}`)
    }
  }
  throw new Error('All rendering providers failed')
}

// ─── Main export ──────────────────────────────────────────────────────────────

// ─── URL normalisation ────────────────────────────────────────────────────────

/**
 * Clean tracking junk from URLs before storing/scraping.
 * Etsy: keep only the listing path, drop all query params.
 * Generic: strip common tracking params (utm_*, ref, fbclid …).
 */
export function cleanUrl(rawUrl: string): string {
  let url: URL
  try { url = new URL(rawUrl.trim()) } catch { return rawUrl.trim() }

  const host = url.hostname.replace(/^www\./, '')

  // Etsy — canonical form is /listing/<id>/<slug>, no query needed
  if (host === 'etsy.com' || host.endsWith('.etsy.com')) {
    const m = url.pathname.match(/\/listing\/\d+\/[^/]+/)
    if (m) return `https://www.etsy.com${m[0]}`
    return `https://www.etsy.com${url.pathname}`
  }

  const TRACKING_PARAMS = [
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'ref','external','cns','sts','content_source','logging_key','ls',
    'fbclid','gclid','msclkid','mc_cid','mc_eid','_ga','_gl',
  ]
  for (const p of TRACKING_PARAMS) url.searchParams.delete(p)
  url.hash = ''
  return url.toString()
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

export function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Sites known to require JS rendering */
export const JS_RENDERED_DOMAINS = new Set([
  'power.se', 'power.no', 'power.dk', 'power.fi',
  'elgiganten.se', 'elgiganten.dk',
  'mediamarkt.se', 'mediamarkt.de', 'mediamarkt.nl',
  'webhallen.com',
  'inet.se',
  'onoff.se',
  'etsy.com',
])

export async function scrapePrice(url: string): Promise<any> {
  try {
    const html = await renderJs(url)
    const result = await extractFromHtml(html, url)
    return { ...result, method: 'js-render' }
  } catch (err) {
    return { price: null, method: 'failed', error: String(err) }
  }
}
