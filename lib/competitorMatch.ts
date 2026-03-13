import { cleanUrl } from '@/lib/scraper'

export interface ProductMatchMetadata {
  title?: string | null
  handle?: string | null
  variant?: string | null
  brand?: string | null
  size?: string | null
}

export interface CompetitorPreflightSignals {
  title: string | null
  brand: string | null
  variant: string | null
  size: string | null
  source: string[]
}

export interface MatchEvaluation {
  confidence: number
  reasons: string[]
  matchedSignals: string[]
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(value: string | null | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(normalizeText(value).split(' ').filter(t => t.length > 1))
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hits = 0
  for (const token of Array.from(a)) {
    if (b.has(token)) hits++
  }
  return hits / Math.max(a.size, b.size)
}

function findMetaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
  const match = html.match(re)
  return match?.[1]?.trim() || null
}

function extractTitle(html: string): string | null {
  const ogTitle = findMetaContent(html, 'og:title')
  if (ogTitle) return ogTitle
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!titleMatch) return null
  return titleMatch[1].replace(/\s+/g, ' ').trim() || null
}

function extractJsonLdFirstProduct(html: string): { brand?: string; variant?: string; size?: string; title?: string } {
  const jsonLdRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const type = String(item?.['@type'] ?? '').toLowerCase()
        if (type === 'product' || (Array.isArray(item?.['@type']) && item['@type'].some((v: string) => String(v).toLowerCase() === 'product'))) {
          const brand = typeof item?.brand === 'string' ? item.brand : item?.brand?.name
          const variant = typeof item?.sku === 'string' ? item.sku : item?.mpn
          const size = typeof item?.size === 'string' ? item.size : item?.weight
          const title = typeof item?.name === 'string' ? item.name : undefined
          return {
            brand: typeof brand === 'string' ? brand : undefined,
            variant: typeof variant === 'string' ? variant : undefined,
            size: typeof size === 'string' ? size : undefined,
            title,
          }
        }
      }
    } catch {
      // ignore malformed json-ld blocks
    }
  }
  return {}
}

function extractSizeFromText(value: string | null): string | null {
  if (!value) return null
  const hit = value.match(/\b(\d{1,4}(?:[.,]\d{1,2})?\s?(?:ml|l|g|kg|oz|cm|mm|pack|pcs|tb|gb))\b/i)
  return hit?.[1]?.trim() ?? null
}

export async function runCompetitorPreflight(rawUrl: string): Promise<CompetitorPreflightSignals> {
  const url = cleanUrl(rawUrl)
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; PricewatchBot/1.0; +https://pricewatch.local)',
    },
  })

  if (!response.ok) {
    throw new Error(`Preflight failed with status ${response.status}`)
  }

  const html = await response.text()
  const title = extractTitle(html)
  const jsonLd = extractJsonLdFirstProduct(html)
  const brand = jsonLd.brand ?? findMetaContent(html, 'product:brand') ?? findMetaContent(html, 'og:brand')
  const variant = jsonLd.variant ?? findMetaContent(html, 'product:retailer_part_no')
  const titleForSize = jsonLd.title ?? title
  const size = (typeof jsonLd.size === 'string' ? jsonLd.size : null) ?? extractSizeFromText(titleForSize)

  const source: string[] = []
  if (title) source.push('title')
  if (brand) source.push('brand')
  if (variant) source.push('variant')
  if (size) source.push('size')

  return {
    title,
    brand: brand ?? null,
    variant: variant ?? null,
    size,
    source,
  }
}

export function evaluateCompetitorMatch(
  productMeta: ProductMatchMetadata,
  signals: CompetitorPreflightSignals,
): MatchEvaluation {
  const reasons: string[] = []
  const matchedSignals: string[] = []

  const productTitleTokens = tokenSet(productMeta.title)
  const competitorTitleTokens = tokenSet(signals.title)
  const titleOverlap = overlapScore(productTitleTokens, competitorTitleTokens)

  let confidence = 0.15

  if (titleOverlap >= 0.65) {
    confidence += 0.55
    matchedSignals.push('title')
  } else if (titleOverlap >= 0.35) {
    confidence += 0.3
    matchedSignals.push('title-partial')
  } else {
    reasons.push('Low title similarity between merchant product and competitor page.')
  }

  const productBrandTokens = tokenSet(productMeta.brand)
  const competitorBrandTokens = tokenSet(signals.brand)
  if (productBrandTokens.size > 0 && competitorBrandTokens.size > 0) {
    const brandOverlap = overlapScore(productBrandTokens, competitorBrandTokens)
    if (brandOverlap > 0) {
      confidence += 0.2
      matchedSignals.push('brand')
    } else {
      reasons.push('Brand signal appears different.')
    }
  }

  const productVariantTokens = tokenSet(productMeta.variant ?? productMeta.handle)
  const competitorVariantTokens = tokenSet(signals.variant)
  if (productVariantTokens.size > 0 && competitorVariantTokens.size > 0) {
    const variantOverlap = overlapScore(productVariantTokens, competitorVariantTokens)
    if (variantOverlap > 0) {
      confidence += 0.15
      matchedSignals.push('variant')
    } else {
      reasons.push('Variant/SKU signal does not match.')
    }
  }

  const productSize = extractSizeFromText(productMeta.size ?? productMeta.title ?? null)
  if (productSize && signals.size) {
    if (normalizeText(productSize) === normalizeText(signals.size)) {
      confidence += 0.1
      matchedSignals.push('size')
    } else {
      reasons.push('Size/package signal differs.')
    }
  }

  if (!signals.title && !signals.brand && !signals.variant) {
    reasons.push('Could not extract enough product signals from competitor page.')
    confidence = Math.min(confidence, 0.25)
  }

  return {
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    reasons,
    matchedSignals,
  }
}

export const LOW_CONFIDENCE_THRESHOLD = 0.45
