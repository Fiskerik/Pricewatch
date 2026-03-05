import * as cheerio from 'cheerio'
import { CurrencyCode, convertCurrency, normalizeCurrencyCode } from '@/lib/currency'

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

async function extractPriceFromHtml(html: string, url: string, targetCurrency: CurrencyCode): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
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
    let price = parsedAmount
    if (currency !== targetCurrency) {
      try {
        price = await convertCurrency(parsedAmount, currency, targetCurrency)
      } catch (err) {
        console.log('[scraper] currency conversion failed, using source amount', String(err))
      }
    }

    console.log(`[scraper] selector hit ${selector} | raw="${raw.slice(0, 80)}" | scraped_currency=${currency} | target_currency=${targetCurrency} | converted=${price}`)
    if (!isNaN(price) && price > 0 && price < 1000000) return { price, scrapedCurrency: currency }
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
        let price = amount
        if (currency !== targetCurrency) {
          try {
            price = await convertCurrency(amount, currency, targetCurrency)
          } catch (err) {
            console.log('[scraper] currency conversion failed, using source amount', String(err))
          }
        }
        console.log(`[scraper] json-ld hit | scraped_currency=${currency} | target_currency=${targetCurrency} | amount=${amount} | converted=${price}`)
        if (!isNaN(price) && price > 0) return { price, scrapedCurrency: currency }
      }
    } catch {
      // Ignore malformed JSON-LD snippets.
    }
  }

  // Last resort: find first price-like pattern in page text
  const match = html.match(/(?:\$|€|£|kr|USD|EUR|GBP|SEK|NOK|DKK)?\s*([\d]{1,3}(?:[\s.,]\d{3})*(?:[\.,]\d{2})?)/i)
  if (match) {
    const amount = parsePriceText(match[0])
    if (!amount) return { price: null, scrapedCurrency: null }
    const currency = detectCurrency(match[0], url)
    let price = amount
    if (currency !== targetCurrency) {
      try {
        price = await convertCurrency(amount, currency, targetCurrency)
      } catch (err) {
        console.log('[scraper] currency conversion failed, using source amount', String(err))
      }
    }
    console.log(`[scraper] regex fallback hit | raw="${match[0]}" | scraped_currency=${currency} | target_currency=${targetCurrency} | converted=${price}`)
    if (!isNaN(price) && price > 0) return { price, scrapedCurrency: currency }
  }

  return { price: null, scrapedCurrency: null }
}

// ── Direct fetch (free, works on most sites) ────────────────
async function scrapeDirectly(url: string, targetCurrency: CurrencyCode): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
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
  return extractPriceFromHtml(html, url, targetCurrency)
}

// ── ScraperAPI fallback (handles JS rendering, Cloudflare) ──
async function scrapeViaApi(url: string, targetCurrency: CurrencyCode): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  if (!process.env.SCRAPER_API_KEY) return { price: null, scrapedCurrency: null }

  const scraperUrl = new URL('http://api.scraperapi.com')
  scraperUrl.searchParams.set('api_key', process.env.SCRAPER_API_KEY)
  scraperUrl.searchParams.set('url', url)
  scraperUrl.searchParams.set('render', 'true') // JS rendering

  const res = await fetch(scraperUrl.toString(), {
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url, targetCurrency)
}

// ── Main export: try cheap first, fall back ─────────────────
export async function scrapePrice(url: string, preferredCurrency?: string): Promise<{
  price: number | null
  scrapedCurrency: CurrencyCode | null
  targetCurrency: CurrencyCode
  method: 'direct' | 'scraperapi' | 'failed'
  error?: string
}> {
  const targetCurrency = normalizeCurrencyCode(preferredCurrency)

  // Attempt 1: Direct
  try {
    const result = await scrapeDirectly(url, targetCurrency)
    if (result.price !== null) {
      return { ...result, targetCurrency, method: 'direct' }
    }
  } catch (err) {
    // Site blocked direct fetch — fall through to ScraperAPI
  }

  // Attempt 2: ScraperAPI
  try {
    const result = await scrapeViaApi(url, targetCurrency)
    if (result.price !== null) {
      return { ...result, targetCurrency, method: 'scraperapi' }
    }
  } catch (err) {
    return { price: null, scrapedCurrency: null, targetCurrency, method: 'failed', error: String(err) }
  }

  return { price: null, scrapedCurrency: null, targetCurrency, method: 'failed', error: 'Price not found on page' }
}
