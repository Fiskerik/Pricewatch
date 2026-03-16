import {
  detectCurrency,
  ExtractResult,
  parsePriceText,
  pickCandidate,
  ScrapePriceOptions,
  ScrapedCandidate,
  walkJsonForPrices,
} from '../shared'

// ── Next.js site detection ───────────────────────────────────────────────────
// Detects any site built on Next.js by checking for __NEXT_DATA__ in the HTML.
// Works for H&M, NA-KD, Gymshark, and thousands of other Next.js storefronts.
export function detectNextJs(html: string): boolean {
  return html.includes('__NEXT_DATA__') || html.includes('"__N_SSP"') || html.includes('"__N_SSG"')
}

// ── Extract buildId and pageProps from __NEXT_DATA__ ────────────────────────
function extractNextData(html: string): { buildId: string | null; pageProps: any | null } {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
    ?? html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)

  if (!match) {
    // Try inline __NEXT_DATA__ assignment
    const assignMatch = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/i)
    if (!assignMatch) return { buildId: null, pageProps: null }
    try {
      const parsed = JSON.parse(assignMatch[1])
      return {
        buildId: typeof parsed.buildId === 'string' ? parsed.buildId : null,
        pageProps: parsed.props?.pageProps ?? parsed.pageProps ?? null,
      }
    } catch {
      return { buildId: null, pageProps: null }
    }
  }

  try {
    const parsed = JSON.parse(match[1].trim())
    return {
      buildId: typeof parsed.buildId === 'string' ? parsed.buildId : null,
      pageProps: parsed.props?.pageProps ?? parsed.pageProps ?? null,
    }
  } catch {
    return { buildId: null, pageProps: null }
  }
}

// ── Walk __NEXT_DATA__ inline page props ─────────────────────────────────────
// This extracts prices from the server-side props already embedded in the HTML.
// No extra HTTP request needed — the data is already in the page.
function extractFromPageProps(pageProps: any, url: string, options?: ScrapePriceOptions): ExtractResult {
  const candidates: ScrapedCandidate[] = []

  walkJsonForPrices(pageProps, 'nextjs.pageProps', url, (c) => {
    candidates.push({ ...c, source: 'Next.js __NEXT_DATA__' })
  })

  const picked = pickCandidate(candidates, options?.preferredMetric)
  if (picked.price !== null) {
    console.log('[scraper][nextjs] extracted from inline __NEXT_DATA__', {
      url,
      price: picked.price,
      metric: picked.metricUsed,
      candidateCount: candidates.length,
    })
  }

  return picked
}

// ── Fetch from /_next/data/{buildId}/path.json ───────────────────────────────
// Next.js exposes a JSON data API for every page. This endpoint returns the same
// data as getServerSideProps / getStaticProps, structured as clean JSON.
// More reliable than parsing HTML — works across all Next.js storefronts.
async function fetchNextDataApi(
  pageUrl: string,
  buildId: string,
  timeoutMs: number,
): Promise<any | null> {
  try {
    const parsed = new URL(pageUrl)
    // Strip trailing slash from pathname
    const pathname = parsed.pathname.replace(/\/$/, '') || '/'
    const dataUrl = `${parsed.origin}/_next/data/${buildId}${pathname}.json${parsed.search}`

    console.log('[scraper][nextjs] fetching data API', { dataUrl })

    const res = await fetch(dataUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: pageUrl,
      },
    })

    if (!res.ok) {
      console.log('[scraper][nextjs] data API returned non-OK', { status: res.status, dataUrl })
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      console.log('[scraper][nextjs] data API returned non-JSON content-type', { contentType, dataUrl })
      return null
    }

    return await res.json()
  } catch (err) {
    console.log('[scraper][nextjs] data API fetch failed', { pageUrl, error: String(err) })
    return null
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────
// Call this after detectNextJs() returns true.
// First tries inline __NEXT_DATA__ (zero cost), then falls back to the data API.
export async function scrapeNextJsDataApi(
  url: string,
  html: string,
  options?: ScrapePriceOptions,
  timeoutMs = 12_000,
): Promise<ExtractResult> {
  const empty: ExtractResult = {
    price: null,
    scrapedCurrency: null,
    candidates: [],
    matchedPreferredMetric: false,
    metricUsed: null,
  }

  const { buildId, pageProps } = extractNextData(html)

  // Step 1: Try inline page props first — free, no extra request
  if (pageProps) {
    const inlineResult = extractFromPageProps(pageProps, url, options)
    if (inlineResult.price !== null) return inlineResult
  }

  // Step 2: Fall back to /_next/data API
  if (!buildId) {
    console.log('[scraper][nextjs] no buildId found, cannot fetch data API', { url })
    return empty
  }

  const apiData = await fetchNextDataApi(url, buildId, timeoutMs)
  if (!apiData) return empty

  // The data API response wraps props: { pageProps: { ... } }
  const dataPageProps = apiData.pageProps ?? apiData.props?.pageProps ?? apiData

  const candidates: ScrapedCandidate[] = []
  walkJsonForPrices(dataPageProps, 'nextjs.dataApi', url, (c) => {
    candidates.push({ ...c, source: 'Next.js data API' })
  })

  if (candidates.length > 0) {
    console.log('[scraper][nextjs] data API walk found candidates', {
      url,
      buildId,
      candidateCount: candidates.length,
    })
    return pickCandidate(candidates, options?.preferredMetric)
  }

  return empty
}
