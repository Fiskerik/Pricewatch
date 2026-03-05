import * as cheerio from 'cheerio'
import { CurrencyCode, normalizeCurrencyCode } from '@/lib/currency'

const PRICE_SELECTORS = [
  'meta[property="product:price:amount"]',
  '[itemprop="price"]',
  '[data-product-price]',
  '[data-price]',
  '.product__price',
  '.price__regular',
  '.price-item--regular',
  '[class*="product-price"]',
  '[class*="ProductPrice"]',
  'span.price',
  '.price',
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

const NON_PRODUCT_PRICE_HINTS = ['shipping', 'frakt', 'delivery', 'recension', 'review', 'rating', 'kvar', 'stock']

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

function looksLikeNonProductPrice(raw: string): boolean {
  const lowered = raw.toLowerCase()
  return NON_PRODUCT_PRICE_HINTS.some(token => lowered.includes(token))
}

async function extractPriceFromHtml(html: string, url: string, targetCurrency: CurrencyCode): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  const $ = cheerio.load(html)

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
        const price = amount
        console.log(`[scraper] json-ld hit | scraped_currency=${currency} | target_currency=${targetCurrency} | amount=${amount}`)
        if (!isNaN(price) && price > 0) return { price, scrapedCurrency: currency }
      }
    } catch {
      // Ignore malformed JSON-LD snippets.
    }
  }

  for (const selector of PRICE_SELECTORS) {
    const elements = $(selector).toArray()
    for (const el of elements) {
      const node = $(el)
      const content = node.attr('content') || node.attr('data-product-price') || node.attr('data-price') || node.text()
      const raw = content.trim()
      if (!raw || looksLikeNonProductPrice(raw)) continue

      const parsedAmount = parsePriceText(raw)
      if (!parsedAmount) continue

      const currency = detectCurrency(raw, url)
      const price = parsedAmount

      console.log(`[scraper] selector hit ${selector} | raw="${raw.slice(0, 80)}" | scraped_currency=${currency} | target_currency=${targetCurrency} | amount=${price}`)
      if (!isNaN(price) && price > 0 && price < 1000000) return { price, scrapedCurrency: currency }
    }
  }

  const match = html.match(/(?:\$|€|£|kr|USD|EUR|GBP|SEK|NOK|DKK)?\s*([\d]{1,3}(?:[\s.,]\d{3})*(?:[\.,]\d{2})?)/i)
  if (match) {
    if (looksLikeNonProductPrice(match[0])) return { price: null, scrapedCurrency: null }
    const amount = parsePriceText(match[0])
    if (!amount) return { price: null, scrapedCurrency: null }
    const currency = detectCurrency(match[0], url)
    const price = amount
    console.log(`[scraper] regex fallback hit | raw="${match[0]}" | scraped_currency=${currency} | target_currency=${targetCurrency} | amount=${price}`)
    if (!isNaN(price) && price > 0) return { price, scrapedCurrency: currency }
  }

  return { price: null, scrapedCurrency: null }
}

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

async function scrapeViaApi(url: string, targetCurrency: CurrencyCode): Promise<{ price: number | null; scrapedCurrency: CurrencyCode | null }> {
  if (!process.env.SCRAPER_API_KEY) return { price: null, scrapedCurrency: null }

  const scraperUrl = new URL('http://api.scraperapi.com')
  scraperUrl.searchParams.set('api_key', process.env.SCRAPER_API_KEY)
  scraperUrl.searchParams.set('url', url)
  scraperUrl.searchParams.set('render', 'true')

  const res = await fetch(scraperUrl.toString(), {
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  return extractPriceFromHtml(html, url, targetCurrency)
}

export async function scrapePrice(url: string, preferredCurrency?: string): Promise<{
  price: number | null
  scrapedCurrency: CurrencyCode | null
  targetCurrency: CurrencyCode
  method: 'direct' | 'scraperapi' | 'failed'
  error?: string
}> {
  const targetCurrency = normalizeCurrencyCode(preferredCurrency)

  try {
    const result = await scrapeDirectly(url, targetCurrency)
    if (result.price !== null) {
      return { ...result, targetCurrency, method: 'direct' }
    }
  } catch {
    // Fall through to ScraperAPI.
  }

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
