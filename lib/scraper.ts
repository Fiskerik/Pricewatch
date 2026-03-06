export type CurrencyCode = string

// ─── Price text parsing ───────────────────────────────────────────────────────

function parsePriceText(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\u202f/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[^\d,\.]/g, '')

  if (!cleaned || cleaned.length < 1) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
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
  'meta[property="product:price:amount"]',
  '[data-product-price]', '[data-price]', '[data-testid*="price"]',
  '.product-price-now', '.product-price__value', '.product__price-now',
  '.wt-text-title-03', // Etsy main price
  '.wt-text-title-smaller', // Etsy discount price
  '.price-item--regular', // Shopify
  '.price-item--sale', // Shopify sale
  'span.price', '.price',
]

async function extractFromHtml(
  html: string,
  url: string,
): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {

  // 1. JSON-LD (Standard för Shopify, WooCommerce, Etsy)
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        // Kolla både Product och Offer direkt (vissa butiker separerar dem)
        const offer = item.offers || (item['@type'] === 'Offer' ? item : null)
        if (offer) {
          const amount = offer.lowPrice || offer.price
          const currency = offer.priceCurrency || offer.lowPriceCurrency
          if (amount) {
            const n = parseFloat(String(amount))
            if (!isNaN(n)) return { price: n, scrapedCurrency: currency || detectCurrency('', url) }
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // 2. Etsy Specific - Deep check in INITIAL_STATE (om JS-render är seg)
  if (url.includes('etsy.com')) {
    const stateMatch = html.match(/"price":\s*{\s*"amount":\s*(\d+),\s*"divisor":\s*(\d+)[^}]*"currency_code":\s*"([^"]+)"/i)
    if (stateMatch) {
      const amount = parseInt(stateMatch[1]) / parseInt(stateMatch[2])
      return { price: amount, scrapedCurrency: stateMatch[3] }
    }
  }

  // 3. Meta Tags (Viktigt för Social Commerce)
  const metaPrice = html.match(/<meta[^>]+(?:property|name)="(?:product:price:amount|og:price:amount|price)"[^>]+content="([^"]+)"/i)
  const metaCurr = html.match(/<meta[^>]+(?:property|name)="(?:product:price:currency|og:price:currency|currency)"[^>]+content="([^"]+)"/i)
  if (metaPrice) {
    const n = parseFloat(metaPrice[1].replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) return { price: n, scrapedCurrency: metaCurr ? metaCurr[1] : detectCurrency('', url) }
  }

  // 4. CSS Selectors (Sista utvägen)
  try {
    const { load } = await import('cheerio')
    const $ = load(html)
    for (const selector of PRICE_SELECTORS) {
      const el = $(selector).first()
      const raw = el.attr('content') || el.attr('data-price') || el.text().trim()
      if (raw && !isNonProductPrice(raw)) {
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
  if (!key) throw new Error('SCRAPER_API_KEY missing')
  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')
  apiUrl.searchParams.set('premium', 'true')
  if (url.includes('etsy.com')) apiUrl.searchParams.set('wait_for_selector', '.wt-text-title-03')
  
  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(60_000) })
  return res.text()
}

async function renderWithBrowserless(url: string): Promise<string> {
  const key = process.env.BROWSERLESS_API_KEY
  if (!key) throw new Error('BROWSERLESS_API_KEY missing')
  const body = JSON.stringify({
    url,
    waitFor: 8000,
    gotoOptions: { waitUntil: 'networkidle0', timeout: 40000 },
    setExtraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
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
      console.warn(`[scraper] ${provider.name} failed for ${url}`)
    }
  }
  throw new Error('All JS renderers failed')
}

// ─── URL normalisation ────────────────────────────────────────────────────────

export function cleanUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim())
    const host = url.hostname.replace(/^www\./, '')
    if (host.includes('etsy.com')) {
      const m = url.pathname.match(/\/listing\/\d+/)
      if (m) return `https://www.etsy.com${m[0]}`
    }
    const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid', 'ref']
    TRACKING.forEach(p => url.searchParams.delete(p))
    return url.origin + url.pathname
  } catch {
    return rawUrl.trim()
  }
}

export function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export const JS_RENDERED_DOMAINS = new Set([
  'power.se', 'power.no', 'power.dk', 'power.fi',
  'elgiganten.se', 'elgiganten.dk', 'mediamarkt.se',
  'webhallen.com', 'inet.se', 'etsy.com', 'shopee.com', 'lazada.com'
])

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'direct' | 'js-render' | 'failed'
  error?: string
}

export async function scrapePrice(url: string, _targetCurrency?: string): Promise<ScrapeResult> {
  const domain = getDomain(url)
  
  // Vi använder rendering som standard för att undvika Cloudflare-blockeringar på små butiker
  try {
    const html = await renderJs(url)
    const result = await extractFromHtml(html, url)
    if (result.price !== null) {
      return { ...result, method: 'js-render' }
    }
    return { price: null, scrapedCurrency: null, method: 'failed', error: 'Price not found' }
  } catch (err) {
    return { price: null, scrapedCurrency: null, method: 'failed', error: String(err) }
  }
}
