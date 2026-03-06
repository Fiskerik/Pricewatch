export type CurrencyCode = string

export interface ScrapedCandidate {
  metric: string
  source: string
  price: number
  currency: CurrencyCode
}

interface ExtractOptions {
  preferredMetric?: string | null
}

interface ExtractResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  candidates: ScrapedCandidate[]
  matchedPreferredMetric: boolean
}

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

function pickCandidate(candidates: ScrapedCandidate[], preferredMetric?: string | null): ExtractResult {
  if (candidates.length === 0) {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
  }

  const preferred = preferredMetric
    ? candidates.find(c => c.metric === preferredMetric)
    : null

  const picked = preferred ?? candidates[0]
  return {
    price: picked.price,
    scrapedCurrency: picked.currency,
    candidates,
    matchedPreferredMetric: Boolean(preferred),
  }
}

// ─── H&M-specific helpers ─────────────────────────────────────────────────────

/**
 * Parse a H&M price object from __NEXT_DATA__ or their API.
 *
 * H&M stores two price representations:
 *   value         → integer in minor units (öre/cent), e.g. 44900 for SEK 449
 *   formattedValue → human-readable string,           e.g. "449,00"
 *
 * We ALWAYS prefer formattedValue (already in major units).
 * We only fall back to `value` and apply /100 when formattedValue is absent.
 */
function parseHmPriceObject(
  obj: any,
  metricName: string,
  url: string,
): { price: number; currency: string } | null {
  if (!obj || typeof obj !== 'object') return null
  const curr: string =
    obj.currencyIso ?? obj.currency ?? obj.currencyCode ?? detectCurrency('', url)
  if (!curr) return null

  // 1. Prefer formattedValue — always in major units, e.g. "449,00"
  if (obj.formattedValue != null) {
    const amount = parsePriceText(String(obj.formattedValue))
    if (amount) {
      console.log('[scraper][hm] formattedValue', { metricName, v: obj.formattedValue, amount, curr })
      return { price: amount, currency: curr }
    }
  }

  // 2. Fall back to raw `value`. Treat as minor units when it's an integer
  //    with 4+ digits in a European currency (SEK 44900 → 449.00 SEK).
  if (obj.value != null) {
    const raw = typeof obj.value === 'number' ? obj.value : parsePriceText(String(obj.value))
    if (raw) {
      const isMinorUnit =
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw >= 1000 &&
        ['SEK', 'NOK', 'DKK', 'EUR', 'GBP'].includes(curr.toUpperCase())
      const amount = isMinorUnit ? raw / 100 : raw
      console.log('[scraper][hm] value field', { metricName, raw, isMinorUnit, amount, curr })
      return { price: amount, currency: curr }
    }
  }

  return null
}

/**
 * Recursively walk a __NEXT_DATA__ (or Next.js data API) JSON tree and collect
 * all H&M price candidates. Handles all known price key names across page versions.
 */
function walkHmNextData(
  obj: any,
  path: string,
  depth: number,
  url: string,
  addCandidate: (c: ScrapedCandidate) => void,
): void {
  if (!obj || typeof obj !== 'object' || depth > 25) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkHmNextData(item, `${path}[${i}]`, depth + 1, url, addCandidate))
    return
  }

  // All named price keys used across H&M page versions
  const hmPriceKeys = [
    'redPrice',       // sale/reduced price (older pages)
    'whitePrice',     // regular price (older pages)
    'salesPrice',     // sale price (newer pages)
    'originalPrice',  // was/strikethrough price
    'discountedPrice',
    'nowPrice',       // UK/international variant
    'currentPrice',
    'basePrice',
    'unitPrice',
  ]

  for (const key of hmPriceKeys) {
    if (key in obj && obj[key] && typeof obj[key] === 'object') {
      const parsed = parseHmPriceObject(obj[key], `hm.nextData.${path}.${key}`, url)
      if (parsed) {
        addCandidate({
          metric: `hm.nextData.${path}.${key}`,
          source: 'HM __NEXT_DATA__',
          price: parsed.price,
          currency: parsed.currency,
        })
      }
    }
  }

  // Older format: regularPrice as a plain string with sibling currency key
  if (typeof obj.regularPrice === 'string') {
    const amount = parsePriceText(obj.regularPrice)
    const curr = obj.currency ?? obj.currencyIso ?? detectCurrency(obj.regularPrice, url)
    if (amount && curr) {
      addCandidate({
        metric: `hm.nextData.${path}.regularPrice`,
        source: 'HM __NEXT_DATA__',
        price: amount,
        currency: curr,
      })
    }
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      walkHmNextData(obj[key], `${path}.${key}`, depth + 1, url, addCandidate)
    }
  }
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
  // H&M-specific rendered selectors
  '[data-testid="price-value"]',
  '[class*="ProductPriceCurrent"]',
  '[class*="product-price-current"]',
  '[class*="PriceValue"]',
  '.product__price',
  'span.price', '.price',
]

async function extractFromHtml(
  html: string,
  url: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  const candidates: ScrapedCandidate[] = []

  const addCandidate = (candidate: ScrapedCandidate | null) => {
    if (!candidate) return
    if (candidates.some(c => c.metric === candidate.metric)) return
    candidates.push(candidate)
  }

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

  const extractOfferFromNode = (node: any, prefix = 'jsonld'): void => {
    if (!node || typeof node !== 'object') return

    const offers = node.offers || (node['@type'] === 'Offer' ? node : null)
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : []

    offerList.forEach((offer: any, index: number) => {
      if (!offer || typeof offer !== 'object') return
      const amount = normalizeAmount(offer.lowPrice ?? offer.price)
      if (!amount) return
      const currency = offer.priceCurrency || offer.lowPriceCurrency || detectCurrency('', url)
      addCandidate({
        metric: `${prefix}.offers[${index}].${offer.lowPrice !== undefined ? 'lowPrice' : 'price'}`,
        source: 'JSON-LD',
        price: amount,
        currency,
      })
    })

    if (Array.isArray(node['@graph'])) {
      node['@graph'].forEach((entry: any, index: number) => extractOfferFromNode(entry, `${prefix}.graph[${index}]`))
    }
  }

  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      const productItems = items.filter((item: any) => isProductNode(item) && isLikelyCurrentProduct(item))
      const extractionTargets = productItems.length > 0 ? productItems : items
      extractionTargets.forEach((item: any, index: number) => extractOfferFromNode(item, `jsonld[${index}]`))
    } catch {
      // ignore malformed block
    }
  }

  const shopifyProductJsonRe = /<script[^>]+type="application\/json"[^>]*id="ProductJson[^"']*"[^>]*>([\s\S]*?)<\/script>/gi
  while ((m = shopifyProductJsonRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const variants = Array.isArray(parsed?.variants) ? parsed.variants : []
      const currency = parsed?.currency || detectCurrency('', url)
      variants.forEach((variant: any, index: number) => {
        const cents = variant?.price
        if (typeof cents !== 'number' || cents <= 0) return
        const amount = Number.isInteger(cents) ? cents / 100 : cents
        addCandidate({
          metric: `shopify.productJson.variants[${index}].price`,
          source: 'Shopify ProductJson',
          price: amount,
          currency,
        })
      })
    } catch {
      // ignore malformed block
    }
  }

  if (url.includes('etsy.com')) {
    const stateMatch = html.match(/"price":\s*{\s*"amount":\s*(\d+),\s*"divisor":\s*(\d+)[^}]*"currency_code":\s*"([^"]+)"/i)
    if (stateMatch) {
      const divisor = parseInt(stateMatch[2], 10)
      if (divisor > 0) {
        addCandidate({
          metric: 'etsy.initialState.price.amount',
          source: 'Etsy state',
          price: parseInt(stateMatch[1], 10) / divisor,
          currency: stateMatch[3],
        })
      }
    }
  }

  // ── H&M ───────────────────────────────────────────────────────────────────
  if (url.includes('hm.com')) {

    // Strategy 1: Parse __NEXT_DATA__ using the corrected walker
    const nextDataMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        walkHmNextData(nextData, 'root', 0, url, addCandidate)
      } catch {
        // ignore malformed __NEXT_DATA__
      }
    }

    // Strategy 2: Regex fallback on raw HTML.
    //
    // ⚠️  CRITICAL FIX: only match "formattedValue" (a quoted string like "449,00").
    // Do NOT match `value` (an unquoted integer like 44900 = minor units).
    // The previous "value|formattedValue" pattern with optional quotes was the root
    // cause of the ×100 price bug — it grabbed the unquoted integer first.
    const hmPatterns: Array<{ re: RegExp; metricPrefix: string; source: string }> = [
      {
        // Sale price (red tag)
        re: /"redPrice"\s*:\s*\{[^}]{0,600}"formattedValue"\s*:\s*"([\d.,]+)"[^}]{0,600}"currencyIso"\s*:\s*"([A-Z]{3})"/gi,
        metricPrefix: 'hm.regex.redPrice',
        source: 'HM redPrice regex',
      },
      {
        // Regular price (white tag)
        re: /"whitePrice"\s*:\s*\{[^}]{0,600}"formattedValue"\s*:\s*"([\d.,]+)"[^}]{0,600}"currencyIso"\s*:\s*"([A-Z]{3})"/gi,
        metricPrefix: 'hm.regex.whitePrice',
        source: 'HM whitePrice regex',
      },
      {
        // Other named price objects
        re: /"(?:salesPrice|currentPrice|salePrice|nowPrice|discountedPrice|originalPrice|basePrice)"\s*:\s*\{[^}]{0,600}"formattedValue"\s*:\s*"([\d.,]+)"[^}]{0,600}"currencyIso"\s*:\s*"([A-Z]{3})"/gi,
        metricPrefix: 'hm.regex.price',
        source: 'HM generic price regex',
      },
      {
        // Flat format: "price": "299", "currencyIso": "SEK"
        re: /"(?:price|salePrice|currentPrice|salesPrice)"\s*:\s*"([\d.,]+)"\s*,\s*"currency(?:Iso)?"\s*:\s*"([A-Z]{3})"/gi,
        metricPrefix: 'hm.regex.flat',
        source: 'HM flat inline price',
      },
    ]

    hmPatterns.forEach(({ re, metricPrefix, source }) => {
      let match: RegExpExecArray | null
      let idx = 0
      while ((match = re.exec(html)) !== null && idx < 10) {
        const amount = parsePriceText(match[1])
        if (!amount) { idx++; continue }
        addCandidate({
          metric: `${metricPrefix}[${idx}]`,
          source,
          price: amount,
          currency: match[2] || detectCurrency(match[0], url),
        })
        idx++
      }
    })
  }

  const metaPrice = html.match(/<meta[^>]+(?:property|name)="(?:product:price:amount|og:price:amount|price)"[^>]+content="([^"]+)"/i)
  const metaCurr = html.match(/<meta[^>]+(?:property|name)="(?:product:price:currency|og:price:currency|currency)"[^>]+content="([^"]+)"/i)
  if (metaPrice) {
    const parsed = parsePriceText(metaPrice[1])
    if (parsed) {
      addCandidate({
        metric: 'meta.product.price.amount',
        source: 'Meta tag',
        price: parsed,
        currency: metaCurr ? metaCurr[1] : detectCurrency('', url),
      })
    }
  }

  try {
    const { load } = await import('cheerio')
    const $ = load(html)
    for (const selector of PRICE_SELECTORS) {
      const el = $(selector).first()
      const raw = el.attr('content') || el.attr('data-price') || el.text().trim()
      if (raw && !isNonProductPrice(raw)) {
        const amount = parsePriceText(raw)
        if (amount) {
          addCandidate({
            metric: `selector:${selector}`,
            source: `Selector (${selector})`,
            price: amount,
            currency: detectCurrency(raw, url),
          })
        }
      }
    }
  } catch {
    // ignore selector pass errors
  }

  const picked = pickCandidate(candidates, options?.preferredMetric)
  if (picked.price !== null) {
    const selectedMetric = candidates.find(c => c.price === picked.price && c.currency === picked.scrapedCurrency)?.metric
    console.log('[scraper] picked html candidate', { url, preferredMetric: options?.preferredMetric ?? null, selectedMetric, matchedPreferred: picked.matchedPreferredMetric, candidateCount: candidates.length })
  }

  return picked
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
  // Wider selector set for H&M — covers both old and new page versions
  if (url.includes('hm.com')) apiUrl.searchParams.set('wait_for_selector', '[data-testid="price-value"],[class*="ProductPriceCurrent"],[class*="price-current"],[class*="PriceValue"],[class*="Price"]')

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
    setExtraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
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
    } catch {
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
  'webhallen.com', 'inet.se', 'etsy.com', 'shopee.com', 'lazada.com',
])

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'direct' | 'js-render' | 'failed'
  candidates: ScrapedCandidate[]
  metricUsed: string | null
  matchedPreferredMetric: boolean
  error?: string
}

interface ScrapePriceOptions {
  preferredMetric?: string | null
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

async function scrapeShopifyProductJson(url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  const productJsonUrl = buildShopifyProductJsonUrl(url)
  if (!productJsonUrl) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }

  try {
    const res = await fetch(productJsonUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'PricewatchBot/1.0 (+https://pricewatch.app)',
      },
    })
    if (!res.ok) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }

    const data = await res.json() as any
    const variants = Array.isArray(data?.variants) ? data.variants : []
    const currency = typeof data?.currency === 'string' ? data.currency : detectCurrency('', url)
    const candidates: ScrapedCandidate[] = []

    variants.forEach((variant: any, index: number) => {
      const cents = variant?.price
      if (typeof cents !== 'number' || cents <= 0) return
      const amount = Number.isInteger(cents) ? cents / 100 : cents
      candidates.push({
        metric: `shopify.js.variants[${index}].price`,
        source: 'Shopify .js endpoint',
        price: amount,
        currency,
      })
    })

    const picked = pickCandidate(candidates, options?.preferredMetric)
    if (picked.price !== null) {
      const selectedMetric = candidates.find(c => c.price === picked.price && c.currency === picked.scrapedCurrency)?.metric
      console.log('[scraper] picked shopify.js candidate', { url, preferredMetric: options?.preferredMetric ?? null, selectedMetric, matchedPreferred: picked.matchedPreferredMetric, candidateCount: candidates.length })
    }

    return picked
  } catch {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
  }
}

// ─── H&M: direct SSR fetch + Next.js data API ─────────────────────────────────
//
// H&M is a Next.js SSR app. We use two cheap strategies before spending a
// JS-render credit:
//
// Step 1 — Plain HTML fetch.
//   If H&M's CDN serves full SSR HTML (including __NEXT_DATA__), parse directly.
//
// Step 2 — Next.js JSON data API.
//   Next.js exposes /_next/data/{buildId}/{page}.json with clean getServerSideProps
//   data. We grab the buildId from __NEXT_DATA__ and fetch that endpoint.
//   This is especially useful when the SSR HTML has __NEXT_DATA__ but the price
//   isn't in the initial props (loaded by a client-side fetch on older page builds).
//
// If both fail, scrapePrice() falls through to the JS-render path.

async function scrapeHmProductDirect(url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  if (!url.includes('hm.com')) {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
    const html = await res.text()

    if (!html.includes('__NEXT_DATA__')) {
      console.log('[scraper][hm] direct fetch: no __NEXT_DATA__, falling through to JS render')
      return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
    }

    // Step 1: parse the SSR HTML
    const htmlResult = await extractFromHtml(html, url, options)
    if (htmlResult.candidates.length > 0) {
      console.log('[scraper][hm] direct SSR fetch succeeded', { candidateCount: htmlResult.candidates.length })
      return htmlResult
    }

    // Step 2: Next.js data API — useful when SSR props don't include price
    const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/)
    if (buildIdMatch) {
      const buildId = buildIdMatch[1]
      try {
        const parsed = new URL(url)
        // e.g. /sv_se/productpage.1244644003.html
        //   → /_next/data/{buildId}/sv_se/productpage.1244644003.html.json
        const dataUrl = `${parsed.origin}/_next/data/${buildId}${parsed.pathname}.json`
        console.log('[scraper][hm] trying Next.js data API', { dataUrl })

        const dataRes = await fetch(dataUrl, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            Accept: 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        })

        if (dataRes.ok) {
          const dataJson = await dataRes.json() as any
          const candidates: ScrapedCandidate[] = []
          const addC = (c: ScrapedCandidate) => {
            if (!candidates.some(x => x.metric === c.metric)) candidates.push(c)
          }
          walkHmNextData(dataJson, 'nextDataApi', 0, url, addC)
          if (candidates.length > 0) {
            console.log('[scraper][hm] Next.js data API succeeded', { candidateCount: candidates.length })
            return pickCandidate(candidates, options?.preferredMetric)
          }
        }
      } catch (err) {
        console.warn('[scraper][hm] Next.js data API failed', String(err))
      }
    }

    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
  } catch (err) {
    console.warn('[scraper][hm] direct fetch threw', String(err))
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false }
  }
}

export async function scrapePrice(url: string, _targetCurrency?: string, options?: ScrapePriceOptions): Promise<ScrapeResult> {
  const allCandidates: ScrapedCandidate[] = []

  // ── H&M: try cheap direct + Next.js data API before spending a render credit ─
  if (url.includes('hm.com')) {
    const hmDirect = await scrapeHmProductDirect(url, options)
    for (const c of hmDirect.candidates) {
      if (!allCandidates.some(e => e.metric === c.metric)) allCandidates.push(c)
    }
  }

  // For Shopify product URLs, try the .js endpoint (fast, no render cost).
  if (url.includes('/products/')) {
    const shopifyJsonResult = await scrapeShopifyProductJson(url, options)
    allCandidates.push(...shopifyJsonResult.candidates)
  }

  // Always run JS rendering to capture the actual displayed price including
  // any currency-app conversions on Shopify stores.
  try {
    const html = await renderJs(url)
    const htmlResult = await extractFromHtml(html, url, { preferredMetric: options?.preferredMetric })
    for (const c of htmlResult.candidates) {
      if (!allCandidates.some(e => e.metric === c.metric)) {
        allCandidates.push(c)
      }
    }
  } catch (err) {
    if (allCandidates.length === 0) {
      return {
        price: null,
        scrapedCurrency: null,
        method: 'failed',
        candidates: [],
        metricUsed: null,
        matchedPreferredMetric: false,
        error: String(err),
      }
    }
  }

  if (allCandidates.length === 0) {
    return {
      price: null,
      scrapedCurrency: null,
      method: 'failed',
      candidates: [],
      metricUsed: null,
      matchedPreferredMetric: false,
      error: 'Price not found',
    }
  }

  const picked = pickCandidate(allCandidates, options?.preferredMetric)
  const selected = allCandidates.find(c => c.price === picked.price && c.currency === picked.scrapedCurrency)

  console.log('[scraper] final pick', {
    url,
    preferredMetric: options?.preferredMetric ?? null,
    metricUsed: selected?.metric ?? null,
    matchedPreferred: picked.matchedPreferredMetric,
    totalCandidates: allCandidates.length,
  })

  return {
    price: picked.price,
    scrapedCurrency: picked.scrapedCurrency,
    candidates: allCandidates,
    matchedPreferredMetric: picked.matchedPreferredMetric,
    method: allCandidates.some(c => c.source.startsWith('Shopify')) ? 'direct' : 'js-render',
    metricUsed: selected?.metric ?? null,
  }
}
