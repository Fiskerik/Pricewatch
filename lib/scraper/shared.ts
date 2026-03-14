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

    if (source.includes('shopify .js endpoint')) {
      reliabilityScore = 120
      reliabilityReason = 'shopify .js endpoint variant price'
    } else if (source.includes('amazon buy box')) {
      reliabilityScore = 125
      reliabilityReason = 'amazon buy-box displayed price'
    } else if (source.includes('json-ld') && metric.includes('.offers')) {
      reliabilityScore = 110
      reliabilityReason = 'json-ld product offers price'
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
