export type CurrencyCode = string

export interface ScrapedCandidate {
  metric: string
  source: string
  price: number
  currency: CurrencyCode
}

export interface ExtractResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  candidates: ScrapedCandidate[]
  matchedPreferredMetric: boolean
  metricUsed: string | null
}

export type FailureReasonCode = 'timeout' | 'blocked' | 'parse_fail' | 'no_candidate'

interface CandidateScore {
  metric: string
  source: string
  finalScore: number
  reliabilityScore: number
  penaltyScore: number
  reliabilityReason: string
  penaltyReasons: string[]
}

export interface ScrapeResult {
  price: number | null
  scrapedCurrency: CurrencyCode | null
  method: 'direct' | 'js-render' | 'failed'
  candidates: ScrapedCandidate[]
  metricUsed: string | null
  matchedPreferredMetric: boolean
  error?: string
  failureCode?: FailureReasonCode
  platform?: 'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic' | 'unknown'
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown'
  stockSource: string | null
}

export interface ScrapePriceOptions {
  preferredMetric?: string | null
}

export interface StockSignalResult {
  status: 'in_stock' | 'out_of_stock' | 'unknown'
  source: string | null
}

export interface DirectApiCandidate {
  url: string
  type: 'shopify_js' | 'shopify_json' | 'generic_json'
}

// ── Bot / challenge page detection ──────────────────────────────────────────
// Detects Cloudflare, PerimeterX, DDoS-Guard and other challenge pages
// that return HTTP 200 but serve no product content.
export function isBotChallengePage(html: string): boolean {
  if (!html || html.length < 100) return true

  const lower = html.toLowerCase()

  // Cloudflare challenges
  if (lower.includes('cf-challenge-running')) return true
  if (lower.includes('cf_chl_opt')) return true
  if (lower.includes('__cf_chl_f_tk')) return true

  // PerimeterX
  if (lower.includes('px-captcha')) return true
  if (lower.includes('_pxappid')) return true
  if (lower.includes('human challenge')) return true

  // DDoS-Guard
  if (lower.includes('ddos-guard')) return true

  // DataDome
  if (lower.includes('datadome')) return true

  // Akamai Bot Manager
  if (lower.includes('akamai-bot-manager')) return true

  // Common challenge page titles
  if (/\<title[^>]*>\s*(just a moment|access denied|attention required|security check|checking your browser|please wait|bot check)/i.test(html)) return true

  // Generic signals: JS-only page with no meaningful content
  if (lower.includes('enable javascript') && html.length < 6000) return true
  if (lower.includes('please enable cookies') && html.length < 6000) return true

  // "Robot or human" pages
  if (lower.includes('robot or human')) return true
  if (lower.includes('are you a human')) return true

  return false
}

// ── Direct API URL candidates ────────────────────────────────────────────────
// Returns structured-data endpoints to try before falling back to JS rendering.
// These endpoints return JSON with price data and require no proxy.
export function detectDirectApiCandidates(url: string): DirectApiCandidate[] {
  const candidates: DirectApiCandidate[] = []

  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname

    // Shopify: /products/slug → /products/slug.js and /products/slug.json
    const shopifyMatch = pathname.match(/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^/?#]+)/i)
    if (shopifyMatch) {
      const base = `${parsed.origin}${shopifyMatch[1]}`
      candidates.push({ url: `${base}.js`, type: 'shopify_js' })
      candidates.push({ url: `${base}.json`, type: 'shopify_json' })
    }

    // Some stores expose /api/product or /api/products/slug
    const genericProductMatch = pathname.match(/^(\/(?:product|item|p)\/[^/?#]+)/i)
    if (genericProductMatch) {
      const base = `${parsed.origin}${genericProductMatch[1]}`
      candidates.push({ url: `${base}.json`, type: 'generic_json' })
    }
  } catch {
    // ignore malformed URLs
  }

  return candidates
}

// ── Extract price from a direct JSON API response ────────────────────────────
export function extractPriceFromDirectJson(
  data: any,
  sourceUrl: string,
  type: DirectApiCandidate['type'],
  options?: ScrapePriceOptions
): ExtractResult {
  const candidates: ScrapedCandidate[] = []
  const currency = detectCurrency('', sourceUrl)

  // Shopify .js / .json — variants array with price in cents
  if (type === 'shopify_js' || type === 'shopify_json') {
    const variants = Array.isArray(data?.variants) ? data.variants : []
    const shopifyCurrency = typeof data?.currency === 'string' ? data.currency : currency

    variants.forEach((variant: any, index: number) => {
      // Shopify stores price in cents as an integer
      const raw = variant?.price
      if (typeof raw !== 'number' || raw <= 0) return
      const amount = Number.isInteger(raw) && raw > 100 ? raw / 100 : raw
      candidates.push({
        metric: `shopify.direct.variants[${index}].price`,
        source: 'Shopify direct API',
        price: amount,
        currency: shopifyCurrency,
      })
    })

    // Also check compare_at_price for the first variant as a data point
    const firstVariant = variants[0]
    if (firstVariant?.compare_at_price && typeof firstVariant.compare_at_price === 'number') {
      const compareAt = Number.isInteger(firstVariant.compare_at_price) && firstVariant.compare_at_price > 100
        ? firstVariant.compare_at_price / 100
        : firstVariant.compare_at_price
      if (compareAt > 0) {
        candidates.push({
          metric: 'shopify.direct.variants[0].compare_at_price',
          source: 'Shopify direct API',
          price: compareAt,
          currency: shopifyCurrency,
        })
      }
    }
  }

  // Generic JSON — walk top-level and common patterns
  if (type === 'generic_json' && data && typeof data === 'object') {
    walkJsonForPrices(data, 'generic', sourceUrl, (c) => candidates.push(c))
  }

  return pickCandidate(candidates, options?.preferredMetric)
}

// ── Generic JSON price walker (used by multiple extractors) ──────────────────
const PRICE_KEY_RE = /^(price|currentprice|saleprice|regularprice|baseprice|offerprice|actualprice|nowprice|redprice|whiteprice|listprice|finalprice|sellingprice|displayprice|retailprice|msrp|lowprice)$/i

export function walkJsonForPrices(
  obj: any,
  pathPrefix: string,
  url: string,
  addCandidate: (c: ScrapedCandidate) => void,
  depth = 0,
  maxDepth = 20,
): void {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      if (i > 20) return // limit array iteration
      walkJsonForPrices(item, `${pathPrefix}[${i}]`, url, addCandidate, depth + 1, maxDepth)
    })
    return
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key]
    const fullPath = `${pathPrefix}.${key}`

    if (PRICE_KEY_RE.test(key)) {
      // Direct numeric value
      if (typeof val === 'number' && val > 0 && val < 10_000_000) {
        addCandidate({
          metric: fullPath,
          source: 'JSON data walk',
          price: val,
          currency: detectCurrency('', url),
        })
      }
      // Direct string value
      else if (typeof val === 'string') {
        const amount = parsePriceText(val)
        if (amount) {
          addCandidate({
            metric: fullPath,
            source: 'JSON data walk',
            price: amount,
            currency: detectCurrency(val, url),
          })
        }
      }
      // Price object: { value, formattedValue, currencyIso }
      else if (val && typeof val === 'object' && !Array.isArray(val)) {
        const priceObj = val
        const objCurrency = priceObj.currencyIso ?? priceObj.currency ?? priceObj.currencyCode ?? detectCurrency('', url)

        if (priceObj.formattedValue != null) {
          const amount = parsePriceText(String(priceObj.formattedValue))
          if (amount) {
            addCandidate({
              metric: `${fullPath}.formattedValue`,
              source: 'JSON data walk',
              price: amount,
              currency: objCurrency,
            })
          }
        }

        if (typeof priceObj.value === 'number' && priceObj.value > 0) {
          // Check for minor unit encoding (e.g. SEK 49900 = 499.00)
          const isMinorUnit =
            Number.isInteger(priceObj.value) &&
            priceObj.value >= 1000 &&
            typeof objCurrency === 'string' &&
            ['SEK', 'NOK', 'DKK', 'JPY', 'HUF', 'CLP', 'KRW'].includes(objCurrency.toUpperCase())
          const amount = isMinorUnit ? priceObj.value / 100 : priceObj.value
          addCandidate({
            metric: `${fullPath}.value`,
            source: 'JSON data walk',
            price: amount,
            currency: objCurrency,
          })
        }

        if (typeof priceObj.amount === 'number' && priceObj.amount > 0) {
          addCandidate({
            metric: `${fullPath}.amount`,
            source: 'JSON data walk',
            price: priceObj.amount,
            currency: objCurrency,
          })
        }

        if (typeof priceObj.amount === 'string') {
          const amount = parsePriceText(priceObj.amount)
          if (amount) {
            addCandidate({
              metric: `${fullPath}.amount`,
              source: 'JSON data walk',
              price: amount,
              currency: objCurrency,
            })
          }
        }
      }
    }

    // Recurse into nested objects (but not into arrays of primitives)
    if (val && typeof val === 'object') {
      walkJsonForPrices(val, fullPath, url, addCandidate, depth + 1, maxDepth)
    }
  }
}

// ── Stock signal extraction ──────────────────────────────────────────────────

const IN_STOCK_AVAILABILITY_TOKENS = [
  'instock',
  'in_stock',
  'limitedavailability',
  'preorder',
  'pre-order',
  'backorder',
]

const OOS_AVAILABILITY_TOKENS = [
  'outofstock',
  'out_of_stock',
  'soldout',
  'sold_out',
  'discontinued',
  'unavailable',
]

const STOCK_TEXT_PATTERNS: Array<{ status: 'in_stock' | 'out_of_stock'; pattern: RegExp }> = [
  { status: 'out_of_stock', pattern: /\b(out\s*of\s*stock|sold\s*out|currently\s+unavailable|not\s+available|temporarily\s+out\s+of\s+stock)\b/i },
  { status: 'in_stock', pattern: /\bonly\s+\d+\s+left\s+in\s+stock\b/i },
  { status: 'in_stock', pattern: /\b(in\s*stock|available\s+now|ready\s+to\s+ship|ships?\s+today|lagerstatus\s*:\s*i\s*lager|i\s*lager|finns\s*i\s*lager)\b/i },
]

function normalizeAvailability(raw: string): 'in_stock' | 'out_of_stock' | null {
  const normalized = raw.toLowerCase().replace(/[^a-z_]/g, '')
  if (IN_STOCK_AVAILABILITY_TOKENS.some(token => normalized.includes(token))) return 'in_stock'
  if (OOS_AVAILABILITY_TOKENS.some(token => normalized.includes(token))) return 'out_of_stock'
  return null
}

export async function extractStockSignal(html: string): Promise<StockSignalResult> {
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null

  const checkObjectForAvailability = (node: any): 'in_stock' | 'out_of_stock' | null => {
    if (!node || typeof node !== 'object') return null
    const availability = typeof node.availability === 'string' ? normalizeAvailability(node.availability) : null
    if (availability) return availability
    const offers = node.offers
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        const status = checkObjectForAvailability(offer)
        if (status) return status
      }
    } else if (offers && typeof offers === 'object') {
      const status = checkObjectForAvailability(offers)
      if (status) return status
    }
    if (Array.isArray(node['@graph'])) {
      for (const entry of node['@graph']) {
        const status = checkObjectForAvailability(entry)
        if (status) return status
      }
    }
    return null
  }

  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const entries = Array.isArray(parsed) ? parsed : [parsed]
      for (const entry of entries) {
        const status = checkObjectForAvailability(entry)
        if (status) return { status, source: 'json_ld.availability' }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  const metaPatterns = [
    /<meta[^>]+(?:property|name)="product:availability"[^>]+content="([^"]+)"/i,
    /<meta[^>]+(?:property|name)="availability"[^>]+content="([^"]+)"/i,
    /<meta[^>]+(?:property|name)="og:availability"[^>]+content="([^"]+)"/i,
  ]
  for (const pattern of metaPatterns) {
    const match = html.match(pattern)
    if (!match) continue
    const normalized = normalizeAvailability(match[1])
    if (normalized) return { status: normalized, source: 'meta.availability' }
  }

  try {
    const { load } = await import('cheerio')
    const $ = load(html)
    const stockScopeText = [
      '[data-testid*="stock"]',
      '[class*="stock"]',
      '[id*="stock"]',
      '[class*="availability"]',
      '[id*="availability"]',
      'body',
    ]
      .map(selector => $(selector).slice(0, selector === 'body' ? 1 : 5).text())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    for (const rule of STOCK_TEXT_PATTERNS) {
      if (rule.pattern.test(stockScopeText)) {
        return { status: rule.status, source: `text_pattern.${rule.status}` }
      }
    }
  } catch {
    // ignore cheerio parsing errors
  }

  return { status: 'unknown', source: null }
}

// ── Price text parsing ───────────────────────────────────────────────────────

export function parsePriceText(raw: string): number | null {
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

// ── Currency detection ───────────────────────────────────────────────────────

const CURRENCY_SYMBOL_MAP: Record<string, CurrencyCode> = {
  '$': 'USD', '€': 'EUR', '£': 'GBP',
  kr: 'SEK', sek: 'SEK', nok: 'NOK', dkk: 'DKK',
  cad: 'CAD', aud: 'AUD', jpy: 'JPY', '¥': 'JPY',
}

const DOMAIN_CURRENCY: Record<string, CurrencyCode> = {
  '.se': 'SEK', '.no': 'NOK', '.dk': 'DKK', '.fi': 'EUR',
  '.co.uk': 'GBP', '.uk': 'GBP', '.eu': 'EUR',
}

export function detectCurrency(raw: string, url: string): CurrencyCode {
  const lowered = raw.toLowerCase()
  for (const [token, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (lowered.includes(token)) return code
  }

  try {
    const parsedUrl = new URL(url)
    const host = parsedUrl.hostname.toLowerCase()
    const path = parsedUrl.pathname.toLowerCase()
    for (const [suffix, code] of Object.entries(DOMAIN_CURRENCY)) {
      if (host.endsWith(suffix)) return code
    }

    if (host.includes('hm.com')) {
      if (/\/(sv_se|sv)\b/.test(path)) return 'SEK'
      if (/\/(fi_fi|fi)\b/.test(path)) return 'EUR'
      if (/\/(da_dk|dk)\b/.test(path)) return 'DKK'
      if (/\/(nb_no|nn_no|no)\b/.test(path)) return 'NOK'
      if (/\/(en_gb|gb)\b/.test(path)) return 'GBP'
      if (/\/(en_us|us)\b/.test(path)) return 'USD'
    }

    if (host.includes('etsy.com')) {
      if (url.includes('/fi-')) return 'EUR'
      if (url.includes('/se-')) return 'SEK'
      if (url.includes('/no-')) return 'NOK'
      if (url.includes('/dk-')) return 'DKK'
      if (url.includes('/en-gb/')) return 'GBP'
      if (url.includes('/en-us/')) return 'USD'
      return 'EUR'
    }
  } catch {
    // ignore
  }

  return 'USD'
}

// ── Misc utils ───────────────────────────────────────────────────────────────

const SKIP_TEXT = ['shipping', 'frakt', 'delivery', 'rating', 'rabatt', 'discount', 'kvar', 'stock', 'recensioner', 'betyg']

export function isNonProductPrice(raw: string): boolean {
  return SKIP_TEXT.some(t => raw.toLowerCase().includes(t))
}

export function dedupeCandidates(candidates: ScrapedCandidate[]): ScrapedCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    if (seen.has(candidate.metric)) return false
    seen.add(candidate.metric)
    return true
  })
}

export function pickCandidate(candidates: ScrapedCandidate[], preferredMetric?: string | null): ExtractResult {
  const deduped = dedupeCandidates(candidates)

  if (deduped.length === 0) {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  }

  const scoreCandidate = (candidate: ScrapedCandidate): CandidateScore => {
    const source = candidate.source.toLowerCase()
    const metric = candidate.metric.toLowerCase()

    let reliabilityScore = 10
    let reliabilityReason = 'generic selector/source fallback'

    if (source.includes('shopify direct api')) {
      reliabilityScore = 130
      reliabilityReason = 'shopify direct API variant price'
    } else if (source.includes('shopify .js endpoint')) {
      reliabilityScore = 120
      reliabilityReason = 'shopify .js endpoint variant price'
    } else if (source.includes('amazon buy box')) {
      reliabilityScore = 125
      reliabilityReason = 'amazon buy-box displayed price'
    } else if (source.includes('json-ld') && metric.includes('.offers')) {
      reliabilityScore = 110
      reliabilityReason = 'json-ld product offers price'
    } else if (source.includes('next.js data api') || source.includes('json data walk')) {
      reliabilityScore = 90
      reliabilityReason = 'next.js structured data API'
    } else if (source.includes('shopify productjson')) {
      reliabilityScore = 95
      reliabilityReason = 'shopify embedded ProductJson variant price'
    } else if (source.includes('etsy state') || source.includes('hm __next_data__')) {
      reliabilityScore = 85
      reliabilityReason = 'site app-state product payload'
    } else if (source.includes('meta tag')) {
      reliabilityScore = 40
      reliabilityReason = 'meta product price tag'
    } else if (source.includes('selector')) {
      reliabilityScore = 20
      reliabilityReason = 'css selector extracted text'
    }

    let penaltyScore = 0
    const penaltyReasons: string[] = []

    const addPenalty = (value: number, reason: string) => {
      penaltyScore += value
      penaltyReasons.push(reason)
    }

    if (/(shipping|frakt|delivery|postage|freight)/.test(metric) || /(shipping|frakt|delivery|postage|freight)/.test(source)) {
      addPenalty(80, 'shipping/delivery indicator')
    }
    if (/(originalprice|regularprice|strikethrough|compare_at_price|wasprice|beforeprice|price-item--regular)/.test(metric)) {
      addPenalty(55, 'likely previous/strikethrough price')
    }
    if (/(bundle|pack|setprice|multipack|2for|3for)/.test(metric) || /(bundle|pack|set)/.test(source)) {
      addPenalty(35, 'bundle/set indicator')
    }
    if (/(unitprice|priceper|perkg|perg|perl|perm2|per m2|per st|per item)/.test(metric) || /(unit price|per kg|per l|per m2)/.test(source)) {
      addPenalty(45, 'unit-price indicator')
    }

    return {
      metric: candidate.metric,
      source: candidate.source,
      reliabilityScore,
      penaltyScore,
      finalScore: reliabilityScore - penaltyScore,
      reliabilityReason,
      penaltyReasons,
    }
  }

  const scored = deduped.map(candidate => ({ candidate, score: scoreCandidate(candidate) }))

  const preferred = preferredMetric
    ? scored.find(({ candidate }) => candidate.metric === preferredMetric)
    : null

  const bestByScore = scored.reduce((best, current) => {
    if (!best) return current
    if (current.score.finalScore !== best.score.finalScore) {
      return current.score.finalScore > best.score.finalScore ? current : best
    }
    return current.candidate.metric.localeCompare(best.candidate.metric) < 0 ? current : best
  }, null as (typeof scored)[number] | null)

  const selected = preferred ?? bestByScore
  if (!selected) {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  }

  console.log('[scraper] candidate scoring', {
    preferredMetric: preferredMetric ?? null,
    metricUsed: selected.candidate.metric,
    source: selected.candidate.source,
    matchedPreferredMetric: Boolean(preferred),
    score: selected.score.finalScore,
    scoreBreakdown: {
      reliabilityScore: selected.score.reliabilityScore,
      reliabilityReason: selected.score.reliabilityReason,
      penaltyScore: selected.score.penaltyScore,
      penaltyReasons: selected.score.penaltyReasons,
    },
  })

  return {
    price: selected.candidate.price,
    scrapedCurrency: selected.candidate.currency,
    candidates: deduped,
    metricUsed: selected.candidate.metric,
    matchedPreferredMetric: Boolean(preferred),
  }
}

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
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const JS_RENDERED_DOMAINS = new Set([
  'power.se', 'power.no', 'power.dk', 'power.fi',
  'elgiganten.se', 'elgiganten.dk', 'mediamarkt.se',
  'webhallen.com', 'inet.se', 'etsy.com', 'shopee.com', 'lazada.com',
])
