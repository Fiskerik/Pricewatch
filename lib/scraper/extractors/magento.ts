import { ExtractResult, ScrapePriceOptions } from '../shared'
import { extractGeneric } from './generic'

export function detectMagento(url: string, html?: string): boolean {
  return Boolean(html?.includes('Magento_Ui') || html?.includes('mage-init') || html?.includes('data-price-type'))
}

export async function extractMagento(html: string, url: string, options?: ScrapePriceOptions): Promise<ExtractResult> {
  return extractGeneric(html, url, options)
}
