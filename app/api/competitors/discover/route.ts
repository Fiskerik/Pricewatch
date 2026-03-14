import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import * as cheerio from 'cheerio'
import { scrapePrice } from '@/lib/scraper'

interface DiscoveryCandidate {
  url: string
  label: string
  price: number | null
  currency: string | null
  inStock: boolean
  confidence: number
}

const BLOCKED_HOSTS = new Set([
  'google.com', 'www.google.com', 'shopping.google.com',
  'webcache.googleusercontent.com', 'duckduckgo.com', 'www.duckduckgo.com',
])

function normalizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    parsed.pathname = normalizedPath || '/'
    return parsed.toString()
  } catch {
    return null
  }
}

function extractDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Competitor'
  }
}

function decodeGoogleHref(href: string): string | null {
  if (!href) return null
  if (href.startsWith('/url?')) {
    const urlParams = new URLSearchParams(href.slice('/url?'.length))
    return urlParams.get('q')
  }
  return href
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  return res.text()
}

function pushCandidate(
  candidates: Array<{ url: string; label: string }>,
  rawUrl: string | null | undefined,
  label: string
) {
  if (!rawUrl) return
  const normalized = normalizeUrl(rawUrl)
  if (!normalized) return

  let host = ''
  try {
    host = new URL(normalized).hostname.replace(/^www\./, '')
  } catch {
    return
  }

  if (BLOCKED_HOSTS.has(host)) return
  if (candidates.some(c => c.url === normalized)) return

  candidates.push({
    url: normalized,
    label: label.trim() || extractDomainLabel(normalized),
  })
}

async function discoverFromGoogle(title: string): Promise<Array<{ url: string; label: string }>> {
  const query = encodeURIComponent(`${title} buy`)
  const html = await fetchHtml(`https://www.google.com/search?tbm=shop&q=${query}`)
  const $ = cheerio.load(html)
  const candidates: Array<{ url: string; label: string }> = []

  $('a').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    const decodedHref = decodeGoogleHref(href)
    const text = $(element).text()
    pushCandidate(candidates, decodedHref, text)
  })

  return candidates
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const targetCurrency = typeof body?.currency === 'string' ? body.currency : 'USD'
  const limit = typeof body?.limit === 'number' ? Math.max(1, Math.min(10, Math.trunc(body.limit))) : 3

  if (!productId || !title) {
    return NextResponse.json({ error: 'Missing productId or title' }, { status: 400 })
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, stores!inner(user_id)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()

  if (productError || !product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const { data: existingCompetitors } = await supabase
    .from('competitor_urls')
    .select('url')
    .eq('product_id', productId)

  const existingUrls = new Set(
    (existingCompetitors ?? [])
      .map((entry: { url?: string | null }) => normalizeUrl(entry.url ?? ''))
      .filter((value): value is string => Boolean(value))
  )

  // Discover URLs
  const allUrlCandidates: Array<{ url: string; label: string }> = []

  try {
    const googleCandidates = await discoverFromGoogle(title)
    console.log('[competitors/discover] google candidates', { productId, count: googleCandidates.length })
    allUrlCandidates.push(...googleCandidates)
  } catch (error) {
    console.log('[competitors/discover] google discovery failed', { productId, error: String(error) })
  }

  // Filter out existing competitors
  const newUrlCandidates = allUrlCandidates
    .filter(c => !existingUrls.has(c.url))
    .slice(0, limit * 3) // Get more than we need for filtering

  // Scrape prices and check availability
  const enrichedCandidates: DiscoveryCandidate[] = []

  for (const candidate of newUrlCandidates) {
    try {
      const scrapeResult = await scrapePrice(candidate.url, targetCurrency)
      
      const inStock = scrapeResult.stockStatus === 'in_stock' || scrapeResult.stockStatus === 'unknown'
      
      // Calculate confidence score based on multiple factors
      let confidence = 0.5
      if (scrapeResult.price !== null) confidence += 0.3
      if (inStock) confidence += 0.2
      if (scrapeResult.stockStatus !== 'unknown') confidence += 0.1
      
      enrichedCandidates.push({
        url: candidate.url,
        label: candidate.label,
        price: scrapeResult.price,
        currency: scrapeResult.scrapedCurrency,
        inStock,
        confidence,
      })
    } catch (error) {
      console.log('[competitors/discover] scrape failed', { url: candidate.url, error: String(error) })
      // Still add it with unknown stock so users can review manually.
      enrichedCandidates.push({
        url: candidate.url,
        label: candidate.label,
        price: null,
        currency: null,
        inStock: true,
        confidence: 0.2,
      })
    }
  }

  // Filter and rank:
  // 1. Must be in stock (or unknown stock status)
  // 2. Prefer candidates with prices
  // 3. Sort by price (cheapest first) among those with prices
  const filtered = enrichedCandidates
    .filter(c => c.inStock) // Only in-stock items
    .sort((a, b) => {
      // First, prioritize items with prices
      if (a.price !== null && b.price === null) return -1
      if (a.price === null && b.price !== null) return 1
      
      // Among items with prices, sort by price (cheapest first)
      if (a.price !== null && b.price !== null) {
        return a.price - b.price
      }
      
      // Fallback to confidence
      return b.confidence - a.confidence
    })
    .slice(0, limit)

  console.log('[competitors/discover] ranked candidates', {
    productId,
    requestedTitle: title,
    scrapedCount: enrichedCandidates.length,
    returnedCount: filtered.length,
    returned: filtered.map((candidate) => ({
      label: candidate.label,
      url: candidate.url,
      price: candidate.price,
      currency: candidate.currency,
      confidence: candidate.confidence,
    })),
  })

  return NextResponse.json({ candidates: filtered })
}
