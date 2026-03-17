import { detectCurrency, ExtractResult, ScrapePriceOptions, ScrapedCandidate, pickCandidate } from '../shared'
import { extractGeneric } from './generic'

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

export function detectShopify(url: string, html?: string): boolean {
  return url.includes('/products/') || Boolean(html?.includes('cdn.shopify.com') || html?.includes('Shopify.theme'))
}

export async function scrapeShopifyProductJson(url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  const productJsonUrl = buildShopifyProductJsonUrl(url)
  if (!productJsonUrl) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }

  try {
    const res = await fetch(productJsonUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'PricingspyBot/1.0 (+https://pricingspy.app)',
      },
    })
    if (!res.ok) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }

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
      console.log('[scraper] picked shopify.js candidate', { url, preferredMetric: options?.preferredMetric ?? null, metricUsed: picked.metricUsed, matchedPreferred: picked.matchedPreferredMetric, candidateCount: candidates.length })
    }

    return picked
  } catch {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  }
}

export async function extractShopify(html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  return extractGeneric(html, url, options)
}
