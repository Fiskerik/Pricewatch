import { detectCurrency, ExtractResult, parsePriceText, pickCandidate, ScrapePriceOptions, ScrapedCandidate } from '../shared'
import { extractGeneric } from './generic'

function parseHmPriceObject(
  obj: any,
  metricName: string,
  url: string,
): { price: number; currency: string } | null {
  if (!obj || typeof obj !== 'object') return null
  const curr: string = obj.currencyIso ?? obj.currency ?? obj.currencyCode ?? detectCurrency('', url)
  if (!curr) return null

  if (obj.formattedValue != null) {
    const amount = parsePriceText(String(obj.formattedValue))
    if (amount) {
      console.log('[scraper][hm] formattedValue', { metricName, v: obj.formattedValue, amount, curr })
      return { price: amount, currency: curr }
    }
  }

  if (obj.value != null) {
    const raw = typeof obj.value === 'number' ? obj.value : parsePriceText(String(obj.value))
    if (raw) {
      const isMinorUnit = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1000 && ['SEK', 'NOK', 'DKK', 'EUR', 'GBP'].includes(curr.toUpperCase())
      const amount = isMinorUnit ? raw / 100 : raw
      console.log('[scraper][hm] value field', { metricName, raw, isMinorUnit, amount, curr })
      return { price: amount, currency: curr }
    }
  }

  return null
}

function walkHmNextData(
  obj: any,
  path: string,
  depth: number,
  url: string,
  addCandidate: (c: ScrapedCandidate) => void,
): void {
  if (!obj || typeof obj !== 'object' || depth > 25) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkHmNextData(item, `${path}[${i}]`, depth + 1, url, addCandidate))
    return
  }

  const hmPriceKeys = ['redPrice', 'whitePrice', 'salesPrice', 'originalPrice', 'discountedPrice', 'nowPrice', 'currentPrice', 'basePrice', 'unitPrice']

  for (const key of hmPriceKeys) {
    if (key in obj && obj[key] && typeof obj[key] === 'object') {
      const parsed = parseHmPriceObject(obj[key], `hm.nextData.${path}.${key}`, url)
      if (parsed) {
        addCandidate({
          metric: `hm.nextData.${path}.${key}`,
          source: 'HM __NEXT_DATA__',
          price: parsed.price,
          currency: parsed.currency,
        })
      }
    }
  }

  if (typeof obj.regularPrice === 'string') {
    const amount = parsePriceText(obj.regularPrice)
    const curr = obj.currency ?? obj.currencyIso ?? detectCurrency(obj.regularPrice, url)
    if (amount && curr) {
      addCandidate({
        metric: `hm.nextData.${path}.regularPrice`,
        source: 'HM __NEXT_DATA__',
        price: amount,
        currency: curr,
      })
    }
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      walkHmNextData(obj[key], `${path}.${key}`, depth + 1, url, addCandidate)
    }
  }
}

export async function scrapeHmProductDirect(url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  if (!url.includes('hm.com')) {
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
    const html = await res.text()

    const htmlResult = await extractGeneric(html, url, options)
    if (htmlResult.candidates.length > 0) {
      console.log('[scraper][hm] direct fetch generic extraction succeeded', { candidateCount: htmlResult.candidates.length })
      return htmlResult
    }

    if (!html.includes('__NEXT_DATA__')) {
      console.log('[scraper][hm] direct fetch: no __NEXT_DATA__, falling through to JS render')
      return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
    }

    const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/)
    if (buildIdMatch) {
      const buildId = buildIdMatch[1]
      try {
        const parsed = new URL(url)
        const dataUrl = `${parsed.origin}/_next/data/${buildId}${parsed.pathname}.json`
        console.log('[scraper][hm] trying Next.js data API', { dataUrl })

        const dataRes = await fetch(dataUrl, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        })

        if (dataRes.ok) {
          const dataJson = await dataRes.json() as any
          const candidates: ScrapedCandidate[] = []
          const addC = (c: ScrapedCandidate) => {
            if (!candidates.some(x => x.metric === c.metric)) candidates.push(c)
          }
          walkHmNextData(dataJson, 'nextDataApi', 0, url, addC)
          if (candidates.length > 0) {
            console.log('[scraper][hm] Next.js data API succeeded', { candidateCount: candidates.length })
            return pickCandidate(candidates, options?.preferredMetric)
          }
        }
      } catch (err) {
        console.warn('[scraper][hm] Next.js data API failed', String(err))
      }
    }

    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  } catch (err) {
    console.warn('[scraper][hm] direct fetch threw', String(err))
    return { price: null, scrapedCurrency: null, candidates: [], matchedPreferredMetric: false, metricUsed: null }
  }
}
