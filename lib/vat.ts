/**
 * Apply a VAT rate to a price.
 * vatRate = 25 means 25%, i.e. multiply by 1.25
 */
export function applyVat(price: number, vatRate: number): number {
  if (!vatRate || vatRate <= 0) return price
  return price * (1 + vatRate / 100)
}

/**
 * Remove VAT from a price that already includes it.
 * vatRate = 25 means divide by 1.25
 */
export function removeVat(price: number, vatRate: number): number {
  if (!vatRate || vatRate <= 0) return price
  return price / (1 + vatRate / 100)
}

const VAT_RATE_BY_COUNTRY: Record<string, number> = {
  NONE: 0,
  SE: 25,
  NO: 25,
  DK: 25,
  FI: 24,
  DE: 19,
  FR: 20,
  GB: 20,
  NL: 21,
  ES: 21,
  IT: 22,
  PL: 23,
  AT: 20,
  BE: 21,
  IE: 23,
  CH: 8,
  AU: 10,
  NZ: 15,
  SG: 9,
  JP: 10,
  CA: 5,
  US: 0,
}

export function getVatRateForCountry(countryCode: string | null | undefined): number {
  if (!countryCode) return VAT_RATE_BY_COUNTRY.SE
  return VAT_RATE_BY_COUNTRY[countryCode.toUpperCase()] ?? VAT_RATE_BY_COUNTRY.SE
}

export function detectUserCountryCode(): string {
  if (typeof window === 'undefined') return 'SE'

  const locales = [...(navigator.languages ?? []), navigator.language]
  for (const locale of locales) {
    const parts = locale.replace('_', '-').split('-')
    const region = parts[parts.length - 1]?.toUpperCase()
    if (region && region.length === 2 && region in VAT_RATE_BY_COUNTRY) {
      return region
    }
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzMap: Record<string, string> = {
    'Europe/Stockholm': 'SE',
    'Europe/Oslo': 'NO',
    'Europe/Copenhagen': 'DK',
    'Europe/Helsinki': 'FI',
    'Europe/Berlin': 'DE',
    'Europe/Paris': 'FR',
    'Europe/London': 'GB',
    'Europe/Amsterdam': 'NL',
    'Europe/Madrid': 'ES',
    'Europe/Rome': 'IT',
    'Europe/Warsaw': 'PL',
    'Europe/Vienna': 'AT',
    'Europe/Brussels': 'BE',
    'Europe/Dublin': 'IE',
    'Europe/Zurich': 'CH',
    'Australia/Sydney': 'AU',
    'Pacific/Auckland': 'NZ',
    'Asia/Singapore': 'SG',
    'Asia/Tokyo': 'JP',
    'America/Toronto': 'CA',
  }

  return tzMap[tz] ?? 'SE'
}
