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
}

export interface ScrapePriceOptions {
  preferredMetric?: string | null
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
