import {
  detectCurrency,
  ExtractResult,
  isNonProductPrice,
  parsePriceText,
  pickCandidate,
  ScrapePriceOptions,
  ScrapedCandidate,
} from '../shared'

const PRICE_SELECTORS = [
  '[itemprop="price"]',
  'meta[property="product:price:amount"]',
  '[data-product-price]', '[data-price]', '[data-testid*="price"]',
  '.product-price-now', '.product-price__value', '.product__price-now',
  '.wt-text-title-03',
  '.wt-text-title-smaller',
  '[data-selector="price-only"] .wt-text-title-larger',
  '[data-buy-box-region="price"] .wt-text-title-larger',
  '.price-item--regular',
  '.price-item--sale',
  '[data-testid="white-price"]',
  '[data-testid="price-value"]',
  '[class*="ProductPriceCurrent"]',
  '[class*="product-price-current"]',
  '[class*="PriceValue"]',
  '.product__price',
  'span.price', '.price',
]

export async function extractGeneric(html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  const candidates: ScrapedCandidate[] = []

  const addCandidate = (candidate: ScrapedCandidate | null) => {
    if (!candidate) return
    if (candidates.some(c => c.metric === candidate.metric)) return
    candidates.push(candidate)
  }

  const normalizeAmount = (value: unknown): number | null => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number' && !Number.isNaN(value) && value > 0) return value
    if (typeof value === 'string') return parsePriceText(value)
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
      variants.forEach((variant: any, index: number) => {
        const cents = variant?.price
        if (typeof cents !== 'number' || cents <= 0) return
        const amount = Number.isInteger(cents) ? cents / 100 : cents
        addCandidate({
          metric: `shopify.productJson.variants[${index}].price`,
          source: 'Shopify ProductJson',
          price: amount,
          currency: detectCurrency('', url),
        })
      })
    } catch {
      // ignore malformed block
    }
  }


  const amazonPriceCandidates = [
    {
      metric: 'amazon.buybox.corePrice',
      source: 'Amazon buy box',
      whole: html.match(/id="corePriceDisplay_desktop_feature_div"[\s\S]{0,2500}?a-price-whole[^>]*>\s*([^<]+)\s*</i),
      fraction: html.match(/id="corePriceDisplay_desktop_feature_div"[\s\S]{0,2500}?a-price-fraction[^>]*>\s*([^<]+)\s*</i),
      currencyHint: html.match(/id="corePriceDisplay_desktop_feature_div"[\s\S]{0,800}?a-price-symbol[^>]*>\s*([^<]+)\s*</i),
    },
    {
      metric: 'amazon.buybox.reinventedPrice',
      source: 'Amazon buy box',
      whole: html.match(/id="corePrice_feature_div"[\s\S]{0,2500}?a-price-whole[^>]*>\s*([^<]+)\s*</i),
      fraction: html.match(/id="corePrice_feature_div"[\s\S]{0,2500}?a-price-fraction[^>]*>\s*([^<]+)\s*</i),
      currencyHint: html.match(/id="corePrice_feature_div"[\s\S]{0,800}?a-price-symbol[^>]*>\s*([^<]+)\s*</i),
    },
  ]

  for (const candidate of amazonPriceCandidates) {
    if (!candidate.whole) continue
    const whole = candidate.whole[1].replace(/[^\d.,]/g, '')
    const fraction = candidate.fraction?.[1]?.replace(/[^\d]/g, '') ?? ''
    const amount = parsePriceText(fraction ? `${whole},${fraction}` : whole)
    if (!amount) continue

    const rawCurrency = candidate.currencyHint?.[1] ?? candidate.whole[0]
    addCandidate({
      metric: candidate.metric,
      source: candidate.source,
      price: amount,
      currency: detectCurrency(rawCurrency, url),
    })
  }

  const etsyBuyBoxMatch = html.match(/data-buy-box-region=\"price\"[\s\S]{0,800}?wt-text-title-larger[^>]*>\s*([^<]+)\s*</i)
  if (etsyBuyBoxMatch) {
    const amount = parsePriceText(etsyBuyBoxMatch[1])
    if (amount) {
      addCandidate({
        metric: 'etsy.buybox.price-only',
        source: 'Etsy buy box',
        price: amount,
        currency: detectCurrency(etsyBuyBoxMatch[1], url),
      })
    }
  }

  const etsyStateCurrencyMatch = html.match(/"listing"\s*:\s*\{[\s\S]{0,6000}?"price"\s*:\s*\{[\s\S]{0,400}?"amount"\s*:\s*"([\d.,]+)"[\s\S]{0,200}?"currency_code"\s*:\s*"([A-Z]{3})"/i)
  if (etsyStateCurrencyMatch) {
    const amount = parsePriceText(etsyStateCurrencyMatch[1])
    if (amount) {
      addCandidate({
        metric: 'etsy.state.listing.price.amount',
        source: 'Etsy state',
        price: amount,
        currency: etsyStateCurrencyMatch[2],
      })
    }
  }

  const etsyStateMatch = html.match(/"listing"\s*:\s*\{[\s\S]{0,3000}?"price"\s*:\s*"([\d.,]+)"/i)
  if (etsyStateMatch) {
    const amount = parsePriceText(etsyStateMatch[1])
    if (amount) {
      addCandidate({
        metric: 'etsy.state.listing.price',
        source: 'Etsy state',
        price: amount,
        currency: detectCurrency(etsyStateMatch[0], url),
      })
    }
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
          const indicatesStartingPrice = /(from|starting at|ab\s|från|fra\s|desde)/i.test(raw)
          addCandidate({
            metric: indicatesStartingPrice ? `selector:${selector}:from` : `selector:${selector}`,
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
    console.log('[scraper] picked html candidate', {
      url,
      preferredMetric: options?.preferredMetric ?? null,
      metricUsed: picked.metricUsed,
      matchedPreferred: picked.matchedPreferredMetric,
      candidateCount: candidates.length,
    })
  }

  return picked
}
