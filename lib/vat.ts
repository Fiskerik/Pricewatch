const COUNTRY_VAT_RATES: Record<string, number> = {
  US: 0,
  CN: 13,
  JP: 10,
  DE: 19,
  GB: 20,
  FR: 20,
  IN: 18,
  IT: 22,
  CA: 5,
  BR: 17,
  KR: 10,
  ES: 21,
  AU: 10,
  MX: 16,
  NL: 21,
  TR: 20,
  SA: 15,
  CH: 8.1,
  SE: 25,
  PL: 23,
  BE: 21,
  AR: 21,
  NO: 25,
  AT: 20,
  AE: 5,
  DK: 25,
  IE: 23,
  SG: 9,
  NZ: 15,
  ZA: 15,
}

const TIMEZONE_COUNTRY_FALLBACKS: Record<string, string> = {
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Vienna': 'AT',
  'Europe/Warsaw': 'PL',
  'Europe/Brussels': 'BE',
  'Europe/Dublin': 'IE',
  'Europe/London': 'GB',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Singapore': 'SG',
  'Asia/Dubai': 'AE',
  'Australia/Sydney': 'AU',
  'Pacific/Auckland': 'NZ',
  'America/Toronto': 'CA',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'America/New_York': 'US',
}

function getRegionFromLocale(locale: string | undefined | null): string | null {
  if (!locale) return null

  const normalizedLocale = locale.replace('_', '-')
  const parts = normalizedLocale.split('-')
  if (parts.length < 2) return null

  const region = parts[parts.length - 1]?.toUpperCase()
  if (!region || region.length !== 2) return null
  return region
}

export function detectUserCountryCode(): string | null {
  if (typeof window === 'undefined') return null

  const browserLocales = [
    ...(navigator.languages ?? []),
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]

  for (const locale of browserLocales) {
    const country = getRegionFromLocale(locale)
    if (country) return country
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return timezone ? TIMEZONE_COUNTRY_FALLBACKS[timezone] ?? null : null
}

export function getVatRateForCountry(countryCode: string | null | undefined): number {
  if (!countryCode) return 0
  return COUNTRY_VAT_RATES[countryCode.toUpperCase()] ?? 0
}

export function applyVat(amount: number, vatRate: number): number {
  if (!Number.isFinite(amount)) return amount
  if (vatRate <= 0) return amount
  return amount * (1 + vatRate / 100)
}
