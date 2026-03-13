import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import * as cheerio from 'cheerio'

interface DiscoveryCandidate {
  url: string
  label: string
}

const BLOCKED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'shopping.google.com',
  'webcache.googleusercontent.com',
  'duckduckgo.com',
  'www.duckduckgo.com',
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Search request failed (${res.status})`)
  }

  return res.text()
}

function pushCandidate(candidates: DiscoveryCandidate[], rawUrl: string | null | undefined, label: string) {
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
  if (candidates.some(candidate => candidate.url === normalized)) return

  candidates.push({
    url: normalized,
    label: label.trim() || extractDomainLabel(normalized),
  })
}

async function discoverFromGoogle(title: string): Promise<DiscoveryCandidate[]> {
  const query = encodeURIComponent(`${title} buy`)
  const html = await fetchHtml(`https://www.google.com/search?tbm=shop&q=${query}`)
  const $ = cheerio.load(html)
  const candidates: DiscoveryCandidate[] = []

  $('a').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    const decodedHref = decodeGoogleHref(href)
    const text = $(element).text()
    pushCandidate(candidates, decodedHref, text)
  })

  return candidates
}

async function discoverFromDuckDuckGo(title: string): Promise<DiscoveryCandidate[]> {
  const query = encodeURIComponent(`${title} buy`)
  const html = await fetchHtml(`https://duckduckgo.com/html/?q=${query}`)
  const $ = cheerio.load(html)
  const candidates: DiscoveryCandidate[] = []

  $('a.result__a').each((_, element) => {
    const href = $(element).attr('href')
    const text = $(element).text()
    pushCandidate(candidates, href, text)
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

  const allCandidates: DiscoveryCandidate[] = []

  try {
    const googleCandidates = await discoverFromGoogle(title)
    console.log('[competitors/discover] google candidates', { productId, count: googleCandidates.length })
    allCandidates.push(...googleCandidates)
  } catch (error) {
    console.log('[competitors/discover] google discovery failed', { productId, error: String(error) })
  }

  if (allCandidates.length < limit) {
    try {
      const duckCandidates = await discoverFromDuckDuckGo(title)
      console.log('[competitors/discover] duckduckgo candidates', { productId, count: duckCandidates.length })
      for (const candidate of duckCandidates) {
        if (!allCandidates.some(existing => existing.url === candidate.url)) {
          allCandidates.push(candidate)
        }
      }
    } catch (error) {
      console.log('[competitors/discover] duckduckgo discovery failed', { productId, error: String(error) })
    }
  }

  const filtered = allCandidates
    .filter(candidate => !existingUrls.has(candidate.url))
    .slice(0, limit)

  return NextResponse.json({ candidates: filtered })
}
