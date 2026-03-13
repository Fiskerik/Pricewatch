import { extractBigcommerce, detectBigcommerce } from './extractors/bigcommerce'
import { extractGeneric } from './extractors/generic'
import { scrapeHmProductDirect } from './extractors/hm'
import { extractMagento, detectMagento } from './extractors/magento'
import { extractShopify, detectShopify, scrapeShopifyProductJson } from './extractors/shopify'
import { extractWoocommerce, detectWoocommerce } from './extractors/woocommerce'
import { dedupeCandidates, ExtractResult, pickCandidate, ScrapePriceOptions, ScrapeResult, ScrapedCandidate } from './shared'

async function renderWithScraperApi(url: string): Promise<string> {
  const key = process.env.SCRAPER_API_KEY
  if (!key) throw new Error('SCRAPER_API_KEY missing')
  const apiUrl = new URL('http://api.scraperapi.com')
  apiUrl.searchParams.set('api_key', key)
  apiUrl.searchParams.set('url', url)
  apiUrl.searchParams.set('render', 'true')
  apiUrl.searchParams.set('premium', 'true')
  if (url.includes('etsy.com')) apiUrl.searchParams.set('wait_for_selector', '.wt-text-title-03')
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

function detectPlatform(url: string, html: string): Array<'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic'> {
  const chain: Array<'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic'> = []

  if (detectShopify(url, html)) chain.push('shopify')
  if (detectWoocommerce(url, html)) chain.push('woocommerce')
  if (detectMagento(url, html)) chain.push('magento')
  if (detectBigcommerce(url, html)) chain.push('bigcommerce')

  chain.push('generic')
  return Array.from(new Set(chain))
}

async function runExtractor(name: 'shopify' | 'woocommerce' | 'magento' | 'bigcommerce' | 'generic', html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  if (name === 'shopify') return extractShopify(html, url, options)
  if (name === 'woocommerce') return extractWoocommerce(html, url, options)
  if (name === 'magento') return extractMagento(html, url, options)
  if (name === 'bigcommerce') return extractBigcommerce(html, url, options)
  return extractGeneric(html, url, options)
}

export async function scrapePrice(url: string, _targetCurrency?: string, options?: ScrapePriceOptions): Promise<ScrapeResult> {
  const allCandidates: ScrapedCandidate[] = []

  if (url.includes('hm.com')) {
    const hmDirect = await scrapeHmProductDirect(url, options)
    allCandidates.push(...hmDirect.candidates)
  }

  if (url.includes('/products/')) {
    const shopifyJsonResult = await scrapeShopifyProductJson(url, options)
    allCandidates.push(...shopifyJsonResult.candidates)
  }

  try {
    const html = await renderJs(url)
    const extractorChain = detectPlatform(url, html)
    console.log('[scraper] extractor chain', { url, extractorChain })

    for (const extractorName of extractorChain) {
      const result = await runExtractor(extractorName, html, url, options)
      allCandidates.push(...result.candidates)
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
  }
}

export * from './shared'
