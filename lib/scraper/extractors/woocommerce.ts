import { ExtractResult, ScrapePriceOptions } from '../shared'
import { extractGeneric } from './generic'

export function detectWoocommerce(url: string, html?: string): boolean {
  return /\/product\//i.test(url) || Boolean(html?.includes('woocommerce') || html?.includes('wc-block'))
}

export async function extractWoocommerce(html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  return extractGeneric(html, url, options)
}
