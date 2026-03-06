
export type CurrencyCode = string

// ─── Price text parsing ───────────────────────────────────────────────────────

function parsePriceText(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')   // non-breaking space
    .replace(/\u202f/g, ' ')   // narrow no-break space (Komplett, Power use this: "28\u202f989")
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
    // Special case for Etsy localized domains
    if (host.includes('etsy.com')) {
      if (url.includes('/fi-')) return 'EUR'  // Finland
      if (url.includes('/se-')) return 'SEK'  // Sweden
      if (url.includes('/no-')) return 'NOK'  // Norway
      if (url.includes('/dk-')) return 'DKK'  // Denmark
      if (url.includes('/uk-') || url.includes('/gb-')) return 'GBP'
      return 'EUR'  // Most of Europe uses EUR on Etsy
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
]

async function extractFromHtml(
  html: string,
  url: string,
): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {

  // ── 0. Etsy: comprehensive extraction ────────────────────────
  const etsyHostCheck = (() => { try { return new URL(url).hostname.includes('etsy.com') } catch { return false } })()
  if (etsyHostCheck) {
    console.log('[scraper] Etsy detected, trying multiple extraction methods')
    
    // Method 1: JSON-LD structured data (most reliable)
    const jsonLdReEtsy = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    let m: RegExpExecArray | null
    while ((m = jsonLdReEtsy.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1])
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (item?.['@type'] === 'Product' || item?.offers) {
            const offers = item.offers
            if (offers) {
              // Handle AggregateOffer (product with variants)
              if (offers['@type'] === 'AggregateOffer') {
                const low = offers.lowPrice ?? offers.price
                const currency = offers.priceCurrency ?? offers.lowPriceCurrency ?? 'EUR'
                if (low != null) {
                  const amount = parseFloat(String(low))
                  if (!isNaN(amount) && amount > 0) {
                    console.log(`[scraper] Etsy JSON-LD AggregateOffer found: ${amount} ${currency}`)
                    return { price: amount, scrapedCurrency: currency }
                  }
                }
              }
              // Handle single Offer
              if (offers.price != null) {
                const amount = parseFloat(String(offers.price))
                const currency = offers.priceCurrency ?? 'EUR'
                if (!isNaN(amount) && amount > 0) {
                  console.log(`[scraper] Etsy JSON-LD Offer found: ${amount} ${currency}`)
                  return { price: amount, scrapedCurrency: currency }
                }
              }
              // Handle array of offers
              if (Array.isArray(offers)) {
                const prices = offers.map((o: any) => ({
                  price: parseFloat(String(o.price)),
                  currency: o.priceCurrency ?? 'EUR'
                })).filter(p => !isNaN(p.price) && p.price > 0)
                if (prices.length) {
                  const minPrice = prices.reduce((min, p) => p.price < min.price ? p : min)
                  console.log(`[scraper] Etsy JSON-LD offer array found: ${minPrice.price} ${minPrice.currency}`)
                  return { price: minPrice.price, scrapedCurrency: minPrice.currency }
                }
              }
            }
          }
        }
      } catch (e) { 
        console.warn('[scraper] Etsy JSON-LD parse error:', e)
      }
    }
    
    // Method 2: Meta tags (og:price:amount)
    const metaPriceMatch = html.match(/<meta[^>]+property="(?:product:)?price:amount"[^>]+content="([^"]+)"/i)
    const metaCurrMatch = html.match(/<meta[^>]+property="(?:product:)?price:currency"[^>]+content="([^"]+)"/i)
    if (metaPriceMatch) {
      const amount = parseFloat(metaPriceMatch[1].replace(/[^\d.]/g, ''))
      const currency = metaCurrMatch?.[1] ?? detectCurrency('', url)
      if (!isNaN(amount) && amount > 0) {
        console.log(`[scraper] Etsy meta tag found: ${amount} ${currency}`)
        return { price: amount, scrapedCurrency: currency }
      }
    }
    
    // Method 3: Embedded JSON in scripts (window.__INITIAL_STATE__ pattern)
    // Etsy uses: "price":{"amount":11300,"divisor":100,"currency_code":"EUR"}
    const priceInScript = html.match(/"price":\s*{\s*"amount":\s*(\d+),\s*"divisor":\s*(\d+)[^}]*"currency_code":\s*"([^"]+)"/i)
    if (priceInScript) {
      const amount = parseInt(priceInScript[1]) / parseInt(priceInScript[2])
      const currency = priceInScript[3]
      if (!isNaN(amount) && amount > 0) {
        console.log(`[scraper] Etsy script JSON found: ${amount} ${currency}`)
        return { price: amount, scrapedCurrency: currency }
      }
    }
    
    // Method 4: Simple price field in any JSON
    const simplePriceMatch = html.match(/"(?:price|listing_price|currentPrice)":\s*"?([\d.]+)"?[^}]*"(?:currency[_-]?code|priceCurrency)"?:\s*"([A-Z]{3})"/i)
    if (simplePriceMatch) {
      const amount = parseFloat(simplePriceMatch[1])
      const currency = simplePriceMatch[2]
      if (!isNaN(amount) && amount > 0) {
        console.log(`[scraper] Etsy simple JSON found: ${amount} ${currency}`)
        return { price: amount, scrapedCurrency: currency }
      }
    }
    
    // Method 5: Reverse pattern (currency before price)
    const reversePriceMatch = html.match(/"(?:currency[_-]?code|priceCurrency)":\s*"([A-Z]{3})"[^}]*"(?:price|listing_price)":\s*"?([\d.]+)"?/i)
    if (reversePriceMatch) {
      const currency = reversePriceMatch[1]
      const amount = parseFloat(reversePriceMatch[2])
      if (!isNaN(amount) && amount > 0) {
        console.log(`[scraper] Etsy reverse JSON found: ${amount} ${currency}`)
        return { price: amount, scrapedCurrency: currency }
      }
    }
    
    // Method 6: Data attributes (data-price, data-listing-price, etc.)
    const dataPriceMatch = html.match(/data-(?:listing-)?price="([^"]+)"/i)
    if (dataPriceMatch) {
      const amount = parsePriceText(dataPriceMatch[1])
      if (amount) {
        console.log(`[scraper] Etsy data attribute found: ${amount}`)
        return { price: amount, scrapedCurrency: detectCurrency(dataPriceMatch[1], url) }
      }
    }
    
    // Method 7: Look for price in visible text with currency symbol (last resort)
    const visiblePriceMatch = html.match(/[€£$¥]\s*([\d\s,.]+)|(\d[\d\s,.]+)\s*[€£$¥kr]/i)
    if (visiblePriceMatch) {
      const priceText = visiblePriceMatch[1] || visiblePriceMatch[2]
      const amount = parsePriceText(priceText)
      if (amount && amount > 10) { // Avoid small numbers like ratings
        console.log(`[scraper] Etsy visible text found: ${amount}`)
        return { price: amount, scrapedCurrency: detectCurrency(visiblePriceMatch[0], url) }
      }
    }
    
    console.log('[scraper] Etsy: no price found in HTML with any method')
  }

  // ── 1. JSON-LD (best for compliant sites) ────────────────
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let jsonLdMatch: RegExpExecArray | null
  while ((jsonLdMatch = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1])
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of candidates) {
        const offerRaw = item?.offers
        const offer = offerRaw?.price != null ? offerRaw
          : Array.isArray(offerRaw) ? offerRaw[0] : null
        const amount = offer?.price != null ? parseFloat(String(offer.price)) : null
        if (amount && !isNaN(amount) && amount > 0) {
          return { price: amount, scrapedCurrency: offer?.priceCurrency ?? detectCurrency('', url) }
        }
      }
    } catch { /* malformed */ }
  }

  // ── 2. og/product meta ──────────────────────────────────
  const ogPriceMatch = html.match(/<meta[^>]+property="(?:og|product):price:amount"[^>]+content="([^"]+)"/i)
  const ogCurrMatch  = html.match(/<meta[^>]+property="(?:og|product):price:currency"[^>]+content="([^"]+)"/i)
  if (ogPriceMatch) {
    const amount = parseFloat(ogPriceMatch[1].replace(/[^0-9.]/g, ''))
    if (!isNaN(amount) && amount > 0) {
      return { price: amount, scrapedCurrency: ogCurrMatch?.[1] ?? detectCurrency('', url) }
    }
  }

  // ── 3. __NEXT_DATA__ JSON blob ──────────────────────────
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1])
      const str  = JSON.stringify(json)
      // Try multiple field names used by Nordic/European e-commerce platforms
      const priceFields = [
        'priceIncVat', 'currentPrice', 'salesPrice', 'salePrice',
        'listPrice', 'price', 'regularPrice', 'finalPrice', 'sellingPrice',
      ]
      for (const field of priceFields) {
        const m = str.match(new RegExp(`"${field}":\\s*(\\d{2,7}(?:\\.\\d{1,2})?)`, 'i'))
        if (m) {
          const amount = parseFloat(m[1])
          if (!isNaN(amount) && amount > 100) { // avoid matching small non-price numbers
            return { price: amount, scrapedCurrency: detectCurrency('', url) }
          }
        }
      }
    } catch { /* malformed */ }
  }

  // ── 4. Price in any <script> JSON ───────────────────────
  const scriptPriceFields = ['priceIncVat', 'currentPrice', 'salesPrice', 'salePrice', 'sellingPrice']
  for (const field of scriptPriceFields) {
    const m = html.match(new RegExp(`"${field}":\\s*(\\d{2,7}(?:\\.\\d{1,2})?)`, 'i'))
    if (m) {
      const amount = parseFloat(m[1])
      if (!isNaN(amount) && amount > 100) {
        return { price: amount, scrapedCurrency: detectCurrency('', url) }
      }
    }
  }

  // ── 5. CSS selectors via cheerio ───────────────────────
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
        if (!amount) continue
        return { price: amount, scrapedCurrency: detectCurrency(raw, url) }
      }
    }
  } catch { /* cheerio not available */ }

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
  apiUrl.searchParams.set('country_code', 'se')
  apiUrl.searchParams.set('wait_for_selector', '[class*="price"]') // wait for price to appear

  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(40_000) })
  if (!res.ok) throw new Error(`ScraperAPI ${res.status}: ${await res.text().catch(() => '')}`)
  return res.text()
}

async function renderWithBrowserless(url: string): Promise<string> {
  const key = process.env.BROWSERLESS_API_KEY
  if (!key) throw new Error('BROWSERLESS_API_KEY not set')

  // v2 (newer accounts) and v1 (legacy) endpoints
  const endpoints = [
    `https://production-sfo.browserless.io/content?token=${key}`,
    `https://chrome.browserless.io/content?token=${key}`,
  ]

  const body = JSON.stringify({
    url,
    waitFor: 5000,
    gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
    setExtraHTTPHeaders: { 'Accept-Language': 'sv-SE,sv;q=0.9' },
  })

  let lastErr = ''
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45_000),
        body,
      })
      if (res.status === 404) { lastErr = `404 at ${endpoint}`; continue }
      if (!res.ok) throw new Error(`Browserless ${res.status}: ${await res.text().catch(() => '')}`)
      return res.text()
    } catch (err) {
      lastErr = String(err)
      if (endpoint === endpoints[0]) continue
    }
  }
  throw new Error(`Browserless failed: ${lastErr}`)
}

async function renderWithZenRows(url: string): Promise<string> {
  const key = process.env.ZENROWS_API_KEY
  if (!key) throw new Error('ZENROWS_API_KEY not set')

  const apiUrl = new URL('https://api.zenrows.com/v1/')
  apiUrl.searchParams.set('apikey', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('js_render', 'true')
  apiUrl.searchParams.set('wait', '3000')

  const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(40_000) })
  if (!res.ok) throw new Error(`ZenRows ${res.status}: ${await res.text().catch(() => '')}`)
  return res.text()
}

async function renderJs(url: string): Promise<string> {
  // Try each configured provider in order
  const providers = [
    { name: 'ScraperAPI',   fn: renderWithScraperApi,  key: process.env.SCRAPER_API_KEY },
    { name: 'Browserless',  fn: renderWithBrowserless, key: process.env.BROWSERLESS_API_KEY },
    { name: 'ZenRows',      fn: renderWithZenRows,     key: process.env.ZENROWS_API_KEY },
  ]

  const configured = providers.filter(p => p.key)
  if (configured.length === 0) {
    throw new Error(
      'No JS rendering service configured. ' +
      'Add SCRAPER_API_KEY, BROWSERLESS_API_KEY, or ZENROWS_API_KEY to your Vercel env vars. ' +
      'All have free tiers: scraperapi.com | browserless.io | zenrows.com'
    )
  }

  let lastError = ''
  for (const provider of configured) {
    try {
      console.log(`[scraper] trying ${provider.name} for ${url}`)
      return await provider.fn(url)
    } catch (err) {
      lastError = String(err)
      console.warn(`[scraper] ${provider.name} failed: ${lastError}`)
    }
  }
  throw new Error(`All JS rendering providers failed. Last error: ${lastError}`)
}


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
    // fallback: just drop all params
    return `https://www.etsy.com${url.pathname}`
  }

  // Generic: strip known tracking-only params
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

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Sites known to require JS rendering — direct fetch returns empty HTML */
const JS_RENDERED_DOMAINS = new Set([
  'power.se', 'power.no', 'power.dk', 'power.fi',
  'elgiganten.se', 'elgiganten.dk',
  'mediamarkt.se', 'mediamarkt.de', 'mediamarkt.nl',
  'webhallen.com',
  'inet.se',
  'onoff.se',
  'etsy.com',
])

/** Sites with Cloudflare — direct fetch works but needs realistic headers */
const CLOUDFLARE_DOMAINS = new Set([
  'komplett.se', 'komplett.no', 'komplett.dk',
])

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

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'direct' | 'js-render' | 'failed'
  provider?: string
  error?: string
}

export async function scrapePrice(url: string, _targetCurrency?: string): Promise<ScrapeResult> {
  const domain = getDomain(url)

  // ── Known JS-rendered sites: skip straight to rendering ──
  if (JS_RENDERED_DOMAINS.has(domain)) {
    console.log(`[scraper] ${domain} is JS-rendered, using rendering service`)
    try {
      const html = await renderJs(url)
      const result = await extractFromHtml(html, url)
      if (result.price !== null) {
        return { ...result, method: 'js-render' }
      }
      return { price: null, scrapedCurrency: null, method: 'failed', error: 'Price not found in rendered HTML. The site may require login or the product may be unavailable.' }
    } catch (err) {
      return { price: null, scrapedCurrency: null, method: 'failed', error: String(err) }
    }
  }

  // ── Direct fetch (with browser headers for CF sites) ──
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: BROWSER_HEADERS,
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    // Detect empty JS shell (< 5KB with no price-related text)
    const isEmptyShell = html.length < 8000 && !html.includes('price') && !html.includes('Price')
    if (isEmptyShell) throw new Error('Empty JS shell — falling back to rendering')

    const result = await extractFromHtml(html, url)
    if (result.price !== null) return { ...result, method: 'direct' }

    // Got HTML but no price found — try rendering as fallback
    console.log(`[scraper] direct fetch got HTML but no price for ${url}, trying render`)
  } catch (err) {
    console.warn(`[scraper] direct failed for ${url}: ${String(err)}`)
  }

  // ── Fallback: JS rendering ──
  try {
    const html = await renderJs(url)
    const result = await extractFromHtml(html, url)
    if (result.price !== null) return { ...result, method: 'js-render' }
    return { price: null, scrapedCurrency: null, method: 'failed', error: 'Price not found even after JS rendering. The product may be out of stock, region-locked, or require login.' }
  } catch (err) {
    return { price: null, scrapedCurrency: null, method: 'failed', error: String(err) }
  }
}
