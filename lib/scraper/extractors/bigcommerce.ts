import { ExtractResult, ScrapePriceOptions } from '../shared'
import { extractGeneric } from './generic'

export function detectBigcommerce(url: string, html?: string): boolean {
  return Boolean(html?.includes('cdn.bc0a.com') || html?.includes('bigcommerce') || html?.includes('stencil-utils'))
}

export async function extractBigcommerce(html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  return extractGeneric(html, url, options)
}
