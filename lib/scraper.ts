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
]

function extractPriceFromHtml(html: string): number | null {
  const $ = cheerio.load(html)

  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first()
    if (!el.length) continue

    // Handle meta tags
    const content = el.attr('content') || el.attr('data-product-price') || el.text()
    const raw = content.trim()
    const price = parseFloat(raw.replace(/[^0-9.]/g, ''))

    if (!isNaN(price) && price > 0 && price < 100000) {
      return price
    }
  }

  // Last resort: find first price-like pattern in page text
  const match = html.match(/\$\s*([\d,]+\.\d{2})/)
  if (match) {
    const price = parseFloat(match[1].replace(',', ''))
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
  return extractPriceFromHtml(html)
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
  return extractPriceFromHtml(html)
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
