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

  const normalizeAmount = (value: unknown): number | null => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number' && !Number.isNaN(value) && value > 0) return value
    if (typeof value === 'string') {
      const parsed = parsePriceText(value)
      if (parsed) return parsed
    }
    return null
  }

  const isProductNode = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false
    const t = node['@type']
    if (typeof t === 'string') return t.toLowerCase() === 'product'
    if (Array.isArray(t)) return t.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === 'product')
    return false
  }

  const isLikelyCurrentProduct = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false
    try {
      const current = new URL(url)
      const nodeUrl = typeof node.url === 'string' ? new URL(node.url, current.origin) : null
      if (!nodeUrl) return true
      return nodeUrl.pathname === current.pathname
    } catch {
      return true
    }
  }

  const extractOfferFromNode = (node: any): { price: number; currency: CurrencyCode } | null => {
    if (!node || typeof node !== 'object') return null

    const offers = node.offers || (node['@type'] === 'Offer' ? node : null)
    const candidates = Array.isArray(offers) ? offers : offers ? [offers] : []
    for (const offer of candidates) {
      if (!offer || typeof offer !== 'object') continue
      const amount = normalizeAmount(offer.lowPrice ?? offer.price)
      if (amount) {
        const currency = offer.priceCurrency || offer.lowPriceCurrency || detectCurrency('', url)
        return { price: amount, currency }
      }
    }

    if (Array.isArray(node['@graph'])) {
      for (const entry of node['@graph']) {
        const found = extractOfferFromNode(entry)
        if (found) return found
      }
    }

    return null
  }

  // 1. JSON-LD (Standard för Shopify, WooCommerce, Etsy)
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      const productItems = items.filter((item: any) => isProductNode(item) && isLikelyCurrentProduct(item))
      const candidates = productItems.length > 0 ? productItems : items

      for (const item of candidates) {
        const found = extractOfferFromNode(item)
        if (found) {
          console.log(`[scraper] price found via JSON-LD for ${url}: ${found.price} ${found.currency}`)
          return { price: found.price, scrapedCurrency: found.currency }
        }
      }
    } catch {
      // Some stores include non-JSON script payloads; continue to fallback strategies.
    }
  }

  // 1b. Shopify product JSON scripts often include variant prices when JSON-LD is missing/incomplete.
  const shopifyProductJsonRe = /<script[^>]+type="application\/json"[^>]*id="ProductJson[^"']*"[^>]*>([\s\S]*?)<\/script>/gi
  while ((m = shopifyProductJsonRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const variants = Array.isArray(parsed?.variants) ? parsed.variants : []
      const firstAvailable = variants.find((v: any) => v?.available) || variants[0]
      const cents = firstAvailable?.price
      if (typeof cents === 'number' && cents > 0) {
        const amount = Number.isInteger(cents) ? cents / 100 : cents
        const currency = parsed?.currency || detectCurrency('', url)
        console.log(`[scraper] price found via Shopify ProductJson for ${url}: ${amount} ${currency}`)
        return { price: amount, scrapedCurrency: currency }
      }
    } catch {
      // ignore malformed JSON block
    }
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
    if (!isNaN(n)) {
      const currency = metaCurr ? metaCurr[1] : detectCurrency('', url)
      console.log(`[scraper] price found via meta tags for ${url}: ${n} ${currency}`)
      return { price: n, scrapedCurrency: currency }
    }
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
        if (amount) {
          const currency = detectCurrency(raw, url)
          console.log(`[scraper] price found via selector ${selector} for ${url}: ${amount} ${currency}`)
          return { price: amount, scrapedCurrency: currency }
        }
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

function buildShopifyProductJsonUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const productMatch = parsed.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^\/]+/i)
    if (!productMatch) return null
    return `${parsed.origin}${productMatch[0]}.js`
  } catch {
    return null
  }
}

async function scrapeShopifyProductJson(url: string): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  const productJsonUrl = buildShopifyProductJsonUrl(url)
  if (!productJsonUrl) return { price: null, scrapedCurrency: null }

  try {
    const res = await fetch(productJsonUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'PricewatchBot/1.0 (+https://pricewatch.app)'
      }
    })
    if (!res.ok) return { price: null, scrapedCurrency: null }

    const data = await res.json() as any
    const variants = Array.isArray(data?.variants) ? data.variants : []
    const selected = variants.find((v: any) => v?.available) || variants[0]
    const cents = selected?.price
    if (typeof cents !== 'number' || cents <= 0) return { price: null, scrapedCurrency: null }

    const currency = typeof data?.currency === 'string' ? data.currency : detectCurrency('', url)
    const amount = Number.isInteger(cents) ? cents / 100 : cents

    console.log(`[scraper] price found via Shopify .js endpoint for ${url}: ${amount} ${currency}`)
    return { price: amount, scrapedCurrency: currency }
  } catch {
    return { price: null, scrapedCurrency: null }
  }
}

export async function scrapePrice(url: string, _targetCurrency?: string): Promise<ScrapeResult> {
  // Shopify product JSON endpoint is often the most accurate source for product pages.
  if (url.includes('/products/')) {
    const shopifyJsonResult = await scrapeShopifyProductJson(url)
    if (shopifyJsonResult.price !== null) {
      return { ...shopifyJsonResult, method: 'direct' }
    }
  }
  
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
