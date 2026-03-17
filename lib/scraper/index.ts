import { extractBigcommerce, detectBigcommerce } from './extractors/bigcommerce'
import { extractGeneric } from './extractors/generic'
import { detectNextJs, scrapeNextJsDataApi } from './extractors/nextjs'
import { extractMagento, detectMagento } from './extractors/magento'
import { extractShopify, detectShopify } from './extractors/shopify'
import { extractWoocommerce, detectWoocommerce } from './extractors/woocommerce'
import {
  dedupeCandidates,
  detectDirectApiCandidates,
  extractPriceFromDirectJson,
  extractStockSignal,
  isBotChallengePage,
  FailureReasonCode,
  pickCandidate,
  ScrapePriceOptions,
  ScrapeResult,
  ScrapedCandidate,
} from './shared'

type PlatformName = 'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic'

const SCRAPE_TOTAL_TIMEOUT_MS = 60_000

// How long to allow for each tier before moving on
const TIER1_TIMEOUT_MS = 8_000
const TIER2_TIMEOUT_MS = 12_000

// A high-confidence metric means it came from a direct API or structured data.
// In these cases we can skip the expensive JS render entirely.
const HIGH_CONFIDENCE_SOURCE_PATTERNS = [
  'shopify direct api',
  'shopify .js endpoint',
  'shopify productjson',
  'json-ld',
  'etsy state',
  'next.js data api',
  'next.js __next_data__',
  'amazon buy box',
]

function isHighConfidenceResult(metricUsed: string | null, source?: string): boolean {
  if (!metricUsed) return false
  const combined = `${metricUsed} ${source ?? ''}`.toLowerCase()
  return HIGH_CONFIDENCE_SOURCE_PATTERNS.some(p => combined.includes(p))
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  const safeTimeout = Math.max(1_000, Math.trunc(timeoutMs))
  return AbortSignal.timeout(safeTimeout)
}

function remainingMs(startedAt: number): number {
  return SCRAPE_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
}

// ── ScraperAPI renderer ──────────────────────────────────────────────────────
async function renderWithScraperApi(url: string, timeoutMs: number, forceResidential = false): Promise<string> {
  const key = process.env.SCRAPER_API_KEY
  if (!key) throw new Error('SCRAPER_API_KEY missing')

  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')

  // Use residential proxies either when forced or for known-blocked domains
  const needsResidential = forceResidential || requiresResidentialProxy(url)
  if (needsResidential) {
    apiUrl.searchParams.set('residential', 'true')
    console.log('[scraper] using residential proxy', { url })
  } else {
    apiUrl.searchParams.set('premium', 'true')
  }

  // Site-specific wait selectors for JS-heavy stores
  const waitSelector = getWaitSelector(url)
  if (waitSelector) apiUrl.searchParams.set('wait_for_selector', waitSelector)

  const res = await fetch(apiUrl.toString(), { signal: timeoutSignal(timeoutMs) })
  return res.text()
}

// ── Browserless renderer ─────────────────────────────────────────────────────
async function renderWithBrowserless(url: string, timeoutMs: number): Promise<string> {
  const key = process.env.BROWSERLESS_API_KEY
  if (!key) throw new Error('BROWSERLESS_API_KEY missing')

  const body = JSON.stringify({
    url,
    waitFor: 8000,
    gotoOptions: {
      waitUntil: 'networkidle0',
      timeout: Math.max(10_000, Math.min(35_000, Math.trunc(timeoutMs - 3_000))),
    },
    setExtraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  })

  const res = await fetch(`https://production-sfo.browserless.io/content?token=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: timeoutSignal(timeoutMs),
  })
  return res.text()
}

const RESIDENTIAL_PROXY_DOMAINS = new Set([
  // Major retailers
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.se', 'amazon.fr', 'amazon.it', 'amazon.es',
  // Electronics
  'zalando.com', 'zalando.se', 'zalando.no', 'zalando.dk', 'zalando.de', 'zalando.fi',
  'elgiganten.se', 'elgiganten.dk',
  'power.se', 'power.no', 'power.dk', 'power.fi',
  'mediamarkt.se', 'mediamarkt.de', 'mediamarkt.nl',
  // Fashion — H&M blocks datacenter IPs on all subdomains
  'hm.com', 'www2.hm.com',
  'asos.com', 'boozt.com', 'nelly.com', 'na-kd.com', 'ginatricot.com',
  // Swedish/Nordic general retailers
  'webhallen.com', 'inet.se', 'dustin.se', 'komplett.se', 'kjell.com',
  'cdon.com', 'stadium.se', 'intersport.se',
])

function requiresResidentialProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    return RESIDENTIAL_PROXY_DOMAINS.has(hostname)
  } catch {
    return false
  }
}

// ── Site-specific wait selectors for JS-heavy SPAs ───────────────────────────
// These tell ScraperAPI to wait for a specific element before capturing HTML.
// Only needed for a handful of known SPAs — not a general mechanism.
const WAIT_SELECTOR_MAP: Array<{ test: (url: string) => boolean; selector: string }> = [
  {
    test: (u) => u.includes('etsy.com'),
    selector: '.wt-text-title-03',
  },
  {
    test: (u) => u.includes('hm.com'),
    selector: '[data-testid="white-price"],[data-testid="price-value"],[class*="ProductPriceCurrent"]',
  },
  {
    test: (u) => u.includes('kaufland.de'),
    selector: '[itemprop="price"],meta[property="product:price:amount"],[data-testid*="price"]',
  },
  {
    test: (u) => u.includes('swappie.com'),
    selector: '[data-test*="price"],[data-testid*="price"],[itemprop="price"]',
  },
]

function getWaitSelector(url: string): string | null {
  for (const entry of WAIT_SELECTOR_MAP) {
    if (entry.test(url)) return entry.selector
  }
  return null
}

// ── JS renderer with provider fallback ──────────────────────────────────────
async function renderJs(url: string, timeoutBudgetMs: number, forceResidential = false): Promise<string> {
  const providers = [
    {
      name: 'ScraperAPI',
      fn: (u: string, t: number) => renderWithScraperApi(u, t, forceResidential),
      key: process.env.SCRAPER_API_KEY,
    },
    {
      name: 'Browserless',
      fn: renderWithBrowserless,
      key: process.env.BROWSERLESS_API_KEY,
    },
  ]

  const configured = providers.filter(p => p.key)
  if (configured.length === 0) throw new Error('No JS renderer configured (set SCRAPER_API_KEY or BROWSERLESS_API_KEY)')

  for (const provider of configured) {
    try {
      const timeLeft = Math.min(timeoutBudgetMs, 45_000)
      if (timeLeft < 5_000) throw new Error('Scrape timeout budget exhausted')
      console.log('[scraper] rendering with', { provider: provider.name, url, timeLeft })
      return await provider.fn(url, timeLeft)
    } catch (err) {
      console.warn(`[scraper] ${provider.name} failed`, { url, error: String(err) })
    }
  }

  throw new Error('All JS renderers failed or timed out')
}

// ── Platform detection (from rendered HTML) ──────────────────────────────────
function detectPlatformChain(url: string, html: string): PlatformName[] {
  const chain: PlatformName[] = []
  if (detectShopify(url, html)) chain.push('shopify')
  if (detectWoocommerce(url, html)) chain.push('woocommerce')
  if (detectMagento(url, html)) chain.push('magento')
  if (detectBigcommerce(url, html)) chain.push('bigcommerce')
  chain.push('generic')
  return Array.from(new Set(chain))
}

function detectPrimaryPlatform(url: string, html: string): PlatformName | 'unknown' {
  const chain = detectPlatformChain(url, html)
  return chain.find(name => name !== 'generic') ?? 'generic'
}

async function runPlatformExtractor(
  name: PlatformName,
  html: string,
  url: string,
  options?: ScrapePriceOptions,
) {
  if (name === 'shopify') return extractShopify(html, url, options)
  if (name === 'woocommerce') return extractWoocommerce(html, url, options)
  if (name === 'magento') return extractMagento(html, url, options)
  if (name === 'bigcommerce') return extractBigcommerce(html, url, options)
  return extractGeneric(html, url, options, 'full')
}

function classifyFailure(errorMessage: string): FailureReasonCode {
  const message = errorMessage.toLowerCase()
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout'
  if (
    message.includes('403') || message.includes('429') || message.includes('captcha') ||
    message.includes('forbidden') || message.includes('access denied') || message.includes('blocked')
  ) return 'blocked'
  return 'parse_fail'
}

function makeFailedResult(
  error: string,
  stockStatus: ScrapeResult['stockStatus'] = 'unknown',
  stockSource: string | null = null,
  platform: ScrapeResult['platform'] = 'unknown',
): ScrapeResult {
  return {
    price: null,
    scrapedCurrency: null,
    method: 'failed',
    candidates: [],
    metricUsed: null,
    matchedPreferredMetric: false,
    stockStatus,
    stockSource,
    error,
    failureCode: classifyFailure(error),
    platform,
  }
}

// ── Main scrape function ─────────────────────────────────────────────────────
export async function scrapePrice(
  url: string,
  _targetCurrency?: string,
  options?: ScrapePriceOptions,
): Promise<ScrapeResult> {
  const startedAt = Date.now()
  const allCandidates: ScrapedCandidate[] = []
  let primaryPlatform: PlatformName | 'unknown' = 'unknown'
  let stockStatus: ScrapeResult['stockStatus'] = 'unknown'
  let stockSource: string | null = null

  // ────────────────────────────────────────────────────────────────────────────
  // TIER 1 — Direct structured API endpoints
  // These return clean JSON without needing any proxy or JS rendering.
  // Works for Shopify stores (and any store with a public /products/slug.js endpoint).
  // Cost: 0 proxy credits. Speed: ~1–2s.
  // ────────────────────────────────────────────────────────────────────────────
  const directApiCandidates = detectDirectApiCandidates(url)

  for (const apiCandidate of directApiCandidates) {
    if (remainingMs(startedAt) < 3_000) break
    try {
      const res = await fetch(apiCandidate.url, {
        signal: timeoutSignal(Math.min(TIER1_TIMEOUT_MS, remainingMs(startedAt))),
        headers: {
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
          'User-Agent': 'PricingspyBot/1.0 (+https://pricingspy.app)',
        },
      })

      if (!res.ok) {
        console.log('[scraper] tier1 direct API non-OK', { url: apiCandidate.url, status: res.status })
        continue
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('json') && !contentType.includes('javascript')) continue

      const data = await res.json()
      const result = extractPriceFromDirectJson(data, url, apiCandidate.type, options)

      if (result.price !== null) {
        console.log('[scraper] tier1 direct API hit', {
          url,
          apiUrl: apiCandidate.url,
          type: apiCandidate.type,
          price: result.price,
          metric: result.metricUsed,
        })
        return {
          price: result.price,
          scrapedCurrency: result.scrapedCurrency,
          candidates: result.candidates,
          matchedPreferredMetric: result.matchedPreferredMetric,
          method: 'direct',
          metricUsed: result.metricUsed,
          platform: apiCandidate.type.startsWith('shopify') ? 'shopify' : 'generic',
          stockStatus: 'unknown',
          stockSource: null,
        }
      }

      // Collect candidates even if no confident pick yet
      allCandidates.push(...result.candidates)
    } catch (err) {
      console.log('[scraper] tier1 direct API error', { url: apiCandidate.url, error: String(err) })
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TIER 2 — Lightweight plain fetch + structured data extraction
  // Plain HTTP GET with no proxy. Parses JSON-LD, meta tags, embedded JSON,
  // and Next.js __NEXT_DATA__ from server-rendered HTML.
  // Skips CSS selectors (those need a rendered DOM).
  // Cost: 0 proxy credits. Speed: ~2–4s.
  // ────────────────────────────────────────────────────────────────────────────
  if (remainingMs(startedAt) > TIER2_TIMEOUT_MS) {
    try {
      const tier2TimeoutMs = Math.min(TIER2_TIMEOUT_MS, remainingMs(startedAt) - 5_000)

      const lightRes = await fetch(url, {
        signal: timeoutSignal(tier2TimeoutMs),
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      })

      if (lightRes.ok) {
        const lightHtml = await lightRes.text()

        if (!isBotChallengePage(lightHtml)) {
          // Structured data extraction (JSON-LD, meta tags, embedded JSON)
          const structuredResult = await extractGeneric(lightHtml, url, options, 'structured-only')
          allCandidates.push(...structuredResult.candidates)

          // Next.js data API — works on any Next.js storefront (H&M, Gymshark, etc.)
          if (detectNextJs(lightHtml)) {
            const nextResult = await scrapeNextJsDataApi(
              url,
              lightHtml,
              options,
              Math.min(10_000, remainingMs(startedAt) - 3_000),
            )
            if (nextResult.candidates.length > 0) {
              allCandidates.push(...nextResult.candidates)
              primaryPlatform = 'generic' // Next.js is cross-platform
            }
          }

          // Check if we already have a high-confidence result — skip expensive JS render
          const tier2Pick = pickCandidate(dedupeCandidates(allCandidates), options?.preferredMetric)
          const tier2Source = tier2Pick.metricUsed
            ? allCandidates.find(c => c.metric === tier2Pick.metricUsed)?.source ?? ''
            : ''

          if (tier2Pick.price !== null && isHighConfidenceResult(tier2Pick.metricUsed, tier2Source)) {
            console.log('[scraper] tier2 high-confidence hit — skipping JS render', {
              url,
              price: tier2Pick.price,
              metric: tier2Pick.metricUsed,
              source: tier2Source,
            })

            // Extract stock signal from the already-fetched HTML
            const stockSignal = await extractStockSignal(lightHtml)

            return {
              price: tier2Pick.price,
              scrapedCurrency: tier2Pick.scrapedCurrency,
              candidates: dedupeCandidates(allCandidates),
              matchedPreferredMetric: tier2Pick.matchedPreferredMetric,
              method: 'direct',
              metricUsed: tier2Pick.metricUsed,
              platform: primaryPlatform !== 'unknown'
                ? primaryPlatform
                : detectPrimaryPlatform(url, lightHtml),
              stockStatus: stockSignal.status,
              stockSource: stockSignal.source,
            }
          }

          // Detect platform from lightweight HTML for later use in Tier 3
          if (primaryPlatform === 'unknown') {
            primaryPlatform = detectPrimaryPlatform(url, lightHtml)
          }

          console.log('[scraper] tier2 no high-confidence result, escalating to JS render', {
            url,
            candidatesSoFar: allCandidates.length,
            platform: primaryPlatform,
          })
        } else {
          console.log('[scraper] tier2 bot challenge page detected on plain fetch', { url })
        }
      } else {
        console.log('[scraper] tier2 plain fetch non-OK', { url, status: lightRes.status })
      }
    } catch (err) {
      console.log('[scraper] tier2 plain fetch failed', { url, error: String(err) })
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TIER 3 — JS render via ScraperAPI / Browserless
  // Full headless browser render. Uses residential proxy for known-blocked domains.
  // Cost: 1–5 ScraperAPI credits per call. Speed: ~10–30s.
  // ────────────────────────────────────────────────────────────────────────────
  const needsResidential = requiresResidentialProxy(url)

  try {
    const tier3TimeoutMs = Math.min(45_000, remainingMs(startedAt) - 2_000)
    if (tier3TimeoutMs < 5_000) {
      return makeFailedResult('Timeout budget exhausted before JS render', stockStatus, stockSource, primaryPlatform)
    }

    const html = await renderJs(url, tier3TimeoutMs, needsResidential)

    // Bot challenge detection — must happen before any extraction attempt
    if (isBotChallengePage(html)) {
      console.log('[scraper] tier3 bot challenge page after JS render', {
        url,
        renderedLength: html.length,
        usedResidential: needsResidential,
      })

      // If we already have any candidates from Tier 1/2, use them
      if (allCandidates.length > 0) {
        const fallbackPick = pickCandidate(dedupeCandidates(allCandidates), options?.preferredMetric)
        if (fallbackPick.price !== null) {
          console.log('[scraper] using tier1/2 candidates after tier3 bot challenge', {
            url,
            price: fallbackPick.price,
            metric: fallbackPick.metricUsed,
          })
          return {
            price: fallbackPick.price,
            scrapedCurrency: fallbackPick.scrapedCurrency,
            candidates: dedupeCandidates(allCandidates),
            matchedPreferredMetric: fallbackPick.matchedPreferredMetric,
            method: 'js-render',
            metricUsed: fallbackPick.metricUsed,
            platform: primaryPlatform,
            stockStatus,
            stockSource,
          }
        }
      }

      return makeFailedResult(
        needsResidential
          ? 'Bot challenge page returned even with residential proxy'
          : 'Bot challenge page returned — site requires residential proxy',
        stockStatus,
        stockSource,
        primaryPlatform,
      )
    }

    // Stock signal extraction from rendered HTML
    const stockSignal = await extractStockSignal(html)
    stockStatus = stockSignal.status
    stockSource = stockSignal.source

    // Platform detection from rendered HTML (more accurate than from plain fetch)
    const extractorChain = detectPlatformChain(url, html)
    primaryPlatform = extractorChain.find(name => name !== 'generic') ?? 'generic'

    console.log('[scraper] tier3 extractor chain', { url, extractorChain, stockStatus })

    // Next.js data API from rendered HTML — catch any Next.js stores
    // that weren't caught in Tier 2 (e.g. if Tier 2 plain fetch was blocked)
    if (detectNextJs(html)) {
      const nextResult = await scrapeNextJsDataApi(
        url,
        html,
        options,
        Math.min(10_000, remainingMs(startedAt) - 2_000),
      )
      if (nextResult.candidates.length > 0) {
        allCandidates.push(...nextResult.candidates)
      }
    }

    // Run all detected platform extractors
    for (const extractorName of extractorChain) {
      if (remainingMs(startedAt) <= 0) {
        console.warn('[scraper] timeout budget exhausted mid-chain', { url, extractorName })
        break
      }
      const result = await runPlatformExtractor(extractorName, html, url, options)
      allCandidates.push(...result.candidates)
    }
  } catch (err) {
    const errorText = String(err)
    console.log('[scraper] tier3 JS render failed', { url, error: errorText })

    // If Tier 1/2 found anything, use it rather than reporting failure
    if (allCandidates.length > 0) {
      const fallbackPick = pickCandidate(dedupeCandidates(allCandidates), options?.preferredMetric)
      if (fallbackPick.price !== null) {
        console.log('[scraper] using tier1/2 candidates after tier3 failure', {
          url,
          price: fallbackPick.price,
        })
        return {
          price: fallbackPick.price,
          scrapedCurrency: fallbackPick.scrapedCurrency,
          candidates: dedupeCandidates(allCandidates),
          matchedPreferredMetric: fallbackPick.matchedPreferredMetric,
          method: 'direct',
          metricUsed: fallbackPick.metricUsed,
          platform: primaryPlatform,
          stockStatus,
          stockSource,
        }
      }
    }

    return makeFailedResult(errorText, stockStatus, stockSource, primaryPlatform)
  }

  // ── Final candidate selection ─────────────────────────────────────────────
  const deduped = dedupeCandidates(allCandidates)

  if (deduped.length === 0) {
    return {
      ...makeFailedResult('Price not found in rendered page', stockStatus, stockSource, primaryPlatform),
      failureCode: 'no_candidate',
    }
  }

  const picked = pickCandidate(deduped, options?.preferredMetric)

  console.log('[scraper] final pick', {
    url,
    preferredMetric: options?.preferredMetric ?? null,
    metricUsed: picked.metricUsed,
    matchedPreferred: picked.matchedPreferredMetric,
    totalCandidates: deduped.length,
    stockStatus,
    platform: primaryPlatform,
  })

  return {
    price: picked.price,
    scrapedCurrency: picked.scrapedCurrency,
    candidates: deduped,
    matchedPreferredMetric: picked.matchedPreferredMetric,
    method: 'js-render',
    metricUsed: picked.metricUsed,
    platform: primaryPlatform,
    stockStatus,
    stockSource,
  }
}

export * from './shared'
