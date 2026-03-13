import { extractBigcommerce, detectBigcommerce } from './extractors/bigcommerce'
import { extractGeneric } from './extractors/generic'
import { scrapeHmProductDirect } from './extractors/hm'
import { extractMagento, detectMagento } from './extractors/magento'
import { extractShopify, detectShopify, scrapeShopifyProductJson } from './extractors/shopify'
import { extractWoocommerce, detectWoocommerce } from './extractors/woocommerce'
import { dedupeCandidates, ExtractResult, FailureReasonCode, pickCandidate, ScrapePriceOptions, ScrapeResult, ScrapedCandidate } from './shared'

type PlatformName = 'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic'

const SCRAPE_TOTAL_TIMEOUT_MS = 60_000

function timeoutSignal(timeoutMs: number): AbortSignal {
  const safeTimeout = Math.max(1_000, Math.trunc(timeoutMs))
  return AbortSignal.timeout(safeTimeout)
}

async function renderWithScraperApi(url: string, timeoutMs: number): Promise<string> {
  const key = process.env.SCRAPER_API_KEY
  if (!key) throw new Error('SCRAPER_API_KEY missing')
  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')
  apiUrl.searchParams.set('premium', 'true')
  if (url.includes('etsy.com')) apiUrl.searchParams.set('wait_for_selector', '.wt-text-title-03')
  if (url.includes('hm.com')) apiUrl.searchParams.set('wait_for_selector', '[data-testid="white-price"],[data-testid="price-value"],[class*="ProductPriceCurrent"],[class*="price-current"],[class*="PriceValue"],[class*="Price"]')
  if (url.includes('kaufland.de')) apiUrl.searchParams.set('wait_for_selector', '[itemprop="price"],meta[property="product:price:amount"],[data-testid*="price"],[class*="price"]')
  if (url.includes('swappie.com')) apiUrl.searchParams.set('wait_for_selector', '[data-test*="price"],[data-testid*="price"],[itemprop="price"],[class*="price"]')

  const res = await fetch(apiUrl.toString(), { signal: timeoutSignal(timeoutMs) })
  return res.text()
}

async function renderWithBrowserless(url: string, timeoutMs: number): Promise<string> {
  const key = process.env.BROWSERLESS_API_KEY
  if (!key) throw new Error('BROWSERLESS_API_KEY missing')
  const body = JSON.stringify({
    url,
    waitFor: 8000,
    gotoOptions: { waitUntil: 'networkidle0', timeout: Math.max(10_000, Math.min(35_000, Math.trunc(timeoutMs - 3_000))) },
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

function classifyFailure(errorMessage: string): FailureReasonCode {
  const message = errorMessage.toLowerCase()
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout'
  if (message.includes('403') || message.includes('429') || message.includes('captcha') || message.includes('forbidden') || message.includes('access denied') || message.includes('blocked')) return 'blocked'
  return 'parse_fail'
}

async function renderJs(url: string, remainingTimeMs: () => number): Promise<string> {
  const providers = [
    { name: 'ScraperAPI', fn: renderWithScraperApi, key: process.env.SCRAPER_API_KEY },
    { name: 'Browserless', fn: renderWithBrowserless, key: process.env.BROWSERLESS_API_KEY },
  ]
  const configured = providers.filter(p => p.key)
  for (const provider of configured) {
    try {
      const timeLeft = remainingTimeMs()
      if (timeLeft < 5_000) throw new Error('Scrape timeout budget exhausted before renderer execution')
      return await provider.fn(url, Math.min(timeLeft, 45_000))
    } catch {
      console.warn(`[scraper] ${provider.name} failed for ${url}`)
    }
  }
  throw new Error('All JS renderers failed')
}

function detectPlatform(url: string, html: string): PlatformName[] {
  const chain: PlatformName[] = []

  if (detectShopify(url, html)) chain.push('shopify')
  if (detectWoocommerce(url, html)) chain.push('woocommerce')
  if (detectMagento(url, html)) chain.push('magento')
  if (detectBigcommerce(url, html)) chain.push('bigcommerce')

  chain.push('generic')
  return Array.from(new Set(chain))
}

async function runExtractor(name: PlatformName, html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  if (name === 'shopify') return extractShopify(html, url, options)
  if (name === 'woocommerce') return extractWoocommerce(html, url, options)
  if (name === 'magento') return extractMagento(html, url, options)
  if (name === 'bigcommerce') return extractBigcommerce(html, url, options)
  return extractGeneric(html, url, options)
}

export async function scrapePrice(url: string, _targetCurrency?: string, options?: ScrapePriceOptions): Promise<ScrapeResult> {
  const startedAt = Date.now()
  const remainingTimeMs = () => SCRAPE_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
  const allCandidates: ScrapedCandidate[] = []
  let primaryPlatform: PlatformName | 'unknown' = 'unknown'

  if (url.includes('hm.com')) {
    const hmDirect = await scrapeHmProductDirect(url, options)
    allCandidates.push(...hmDirect.candidates)
  }

  if (url.includes('/products/')) {
    const shopifyJsonResult = await scrapeShopifyProductJson(url, options)
    allCandidates.push(...shopifyJsonResult.candidates)
  }

  try {
    const html = await renderJs(url, remainingTimeMs)
    const extractorChain = detectPlatform(url, html)
    primaryPlatform = extractorChain.find(name => name !== 'generic') ?? 'generic'
    console.log('[scraper] extractor chain', { url, extractorChain })

    for (const extractorName of extractorChain) {
      const result = await runExtractor(extractorName, html, url, options)
      allCandidates.push(...result.candidates)

      if (remainingTimeMs() <= 0) {
        throw new Error('Scrape timed out after 60 seconds')
      }
    }
  } catch (err) {
    if (allCandidates.length === 0) {
      const errorText = String(err)
      return {
        price: null,
        scrapedCurrency: null,
        method: 'failed',
        candidates: [],
        metricUsed: null,
        matchedPreferredMetric: false,
        error: errorText,
        failureCode: classifyFailure(errorText),
        platform: primaryPlatform,
      }
    }
  }

  const deduped = dedupeCandidates(allCandidates)
  if (deduped.length === 0) {
    return {
      price: null,
      scrapedCurrency: null,
      method: 'failed',
      candidates: [],
      metricUsed: null,
      matchedPreferredMetric: false,
      error: 'Price not found',
      failureCode: 'no_candidate',
      platform: primaryPlatform,
    }
  }

  const picked = pickCandidate(deduped, options?.preferredMetric)
  console.log('[scraper] final pick', {
    url,
    preferredMetric: options?.preferredMetric ?? null,
    metricUsed: picked.metricUsed,
    matchedPreferred: picked.matchedPreferredMetric,
    totalCandidates: deduped.length,
  })

  return {
    price: picked.price,
    scrapedCurrency: picked.scrapedCurrency,
    candidates: deduped,
    matchedPreferredMetric: picked.matchedPreferredMetric,
    method: deduped.some(c => c.source.startsWith('Shopify')) ? 'direct' : 'js-render',
    metricUsed: picked.metricUsed,
    platform: primaryPlatform,
  }
}

export * from './shared'
