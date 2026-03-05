import * as cheerio from 'cheerio'

// ── Price selectors — covers ~80% of Shopify stores ────────
const PRICE_SELECTORS = [
  '[data-product-price]',
  '.product__price',
  '.price__regular',
  '.price-item--regular',
  '[class*="product-price"]',
  '[class*="ProductPrice"]',
  'span.price',
  '.price',
  '[itemprop="price"]',
  'meta[property="product:price:amount"]',
  '[data-price]',
  '[class*="price"]',
  '[id*="price"]',
]

type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'SEK' | 'NOK' | 'DKK' | 'CAD' | 'AUD' | 'JPY'

const CURRENCY_SYMBOL_MAP: Record<string, CurrencyCode> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  'kr': 'SEK',
  'sek': 'SEK',
  'nok': 'NOK',
  'dkk': 'DKK',
  'cad': 'CAD',
  'aud': 'AUD',
  'jpy': 'JPY',
  '¥': 'JPY',
}

const DOMAIN_CURRENCY_HINTS: Record<string, CurrencyCode> = {
  '.se': 'SEK',
  '.no': 'NOK',
  '.dk': 'DKK',
  '.co.uk': 'GBP',
  '.uk': 'GBP',
  '.eu': 'EUR',
}

let ratesCache: { expiresAt: number; base: CurrencyCode; rates: Record<string, number> } | null = null

function detectCurrency(raw: string, url: string): CurrencyCode {
  const lowered = raw.toLowerCase()
  for (const [token, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (lowered.includes(token)) return code
  }

  const host = new URL(url).hostname.toLowerCase()
  const domainHint = Object.entries(DOMAIN_CURRENCY_HINTS).find(([suffix]) => host.endsWith(suffix))
  if (domainHint) return domainHint[1]

  return 'USD'
}

function parsePriceText(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,\.\s]/g, '')
    .trim()

  if (!cleaned) return null

  const compact = cleaned.replace(/\s+/g, '')
  const lastComma = compact.lastIndexOf(',')
  const lastDot = compact.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : '.'

  let normalized = compact
  if (decimalSeparator === ',') {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = normalized.replace(/,/g, '')
  }

  const parsed = parseFloat(normalized)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 1000000) return null
  return parsed
}

async function convertToUsd(amount: number, currency: CurrencyCode): Promise<number> {
  if (currency === 'USD') return amount

  const now = Date.now()
  if (!ratesCache || ratesCache.base !== currency || ratesCache.expiresAt < now) {
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        if (data?.rates?.USD) {
          ratesCache = {
            base: currency,
            rates: data.rates,
            expiresAt: now + 1000 * 60 * 15,
          }
        }
      }
    } catch (err) {
      console.log('[scraper] currency conversion failed, using original amount', String(err))
    }
  }

  const usdRate = ratesCache?.base === currency ? ratesCache.rates.USD : null
  if (!usdRate) return amount
  return amount * usdRate
}

async function extractPriceFromHtml(html: string, url: string): Promise<number | null> {
  const $ = cheerio.load(html)

  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first()
    if (!el.length) continue

    // Handle meta tags
    const content = el.attr('content') || el.attr('data-product-price') || el.text()
    const raw = content.trim()
    const parsedAmount = parsePriceText(raw)
    if (!parsedAmount) continue
    const currency = detectCurrency(raw, url)
    const price = await convertToUsd(parsedAmount, currency)

    console.log(`[scraper] selector hit ${selector} | raw="${raw.slice(0, 80)}" | currency=${currency} | usd=${price}`)
    if (!isNaN(price) && price > 0 && price < 1000000) return price
  }

  // JSON-LD product data fallback
  const jsonLdScripts = $('script[type="application/ld+json"]').toArray()
  for (const script of jsonLdScripts) {
    try {
      const rawJson = $(script).contents().text()
      const parsed = JSON.parse(rawJson)
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of candidates) {
        const offer = item?.offers?.price ? item.offers : Array.isArray(item?.offers) ? item.offers[0] : null
        const amount = offer?.price ? parseFloat(String(offer.price)) : null
        if (!amount || Number.isNaN(amount)) continue

        const currency = (offer?.priceCurrency as CurrencyCode | undefined) ?? detectCurrency(rawJson, url)
        const price = await convertToUsd(amount, currency)
        console.log(`[scraper] json-ld hit | currency=${currency} | amount=${amount} | usd=${price}`)
        if (!isNaN(price) && price > 0) return price
      }
    } catch {
      // Ignore malformed JSON-LD snippets.
    }
  }

  // Last resort: find first price-like pattern in page text
  const match = html.match(/(?:\$|€|£|kr|USD|EUR|GBP|SEK|NOK|DKK)?\s*([\d]{1,3}(?:[\s.,]\d{3})*(?:[\.,]\d{2})?)/i)
  if (match) {
    const amount = parsePriceText(match[0])
    if (!amount) return null
    const currency = detectCurrency(match[0], url)
    const price = await convertToUsd(amount, currency)
    console.log(`[scraper] regex fallback hit | raw="${match[0]}" | currency=${currency} | usd=${price}`)
    if (!isNaN(price) && price > 0) return price
  }

  return null
}

// ── Direct fetch (free, works on most sites) ────────────────
async function scrapeDirectly(url: string): Promise<number | null> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

// ── ScraperAPI fallback (handles JS rendering, Cloudflare) ──
async function scrapeViaApi(url: string): Promise<number | null> {
  if (!process.env.SCRAPER_API_KEY) return null

  const scraperUrl = new URL('http://api.scraperapi.com')
  scraperUrl.searchParams.set('api_key', process.env.SCRAPER_API_KEY)
  scraperUrl.searchParams.set('url', url)
  scraperUrl.searchParams.set('render', 'true') // JS rendering

  const res = await fetch(scraperUrl.toString(), {
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url)
}

// ── Main export: try cheap first, fall back ─────────────────
export async function scrapePrice(url: string): Promise<{
  price: number | null
  method: 'direct' | 'scraperapi' | 'failed'
  error?: string
}> {
  // Attempt 1: Direct
  try {
    const price = await scrapeDirectly(url)
    if (price !== null) {
      return { price, method: 'direct' }
    }
  } catch (err) {
    // Site blocked direct fetch — fall through to ScraperAPI
  }

  // Attempt 2: ScraperAPI
  try {
    const price = await scrapeViaApi(url)
    if (price !== null) {
      return { price, method: 'scraperapi' }
    }
  } catch (err) {
    return { price: null, method: 'failed', error: String(err) }
  }

  return { price: null, method: 'failed', error: 'Price not found on page' }
}
