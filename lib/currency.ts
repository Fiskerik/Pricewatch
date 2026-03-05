export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'] as const
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]

const currencySymbolMap: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
}

const ratesCache = new Map<CurrencyCode, { expiresAt: number; rates: Record<string, number> }>()

export function normalizeCurrencyCode(value: unknown, fallback: CurrencyCode = 'USD'): CurrencyCode {
  if (!value || typeof value !== 'string') return fallback
  const upper = value.toUpperCase()
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(upper)) {
    return upper as CurrencyCode
  }
  return fallback
}

export function formatMoney(amount: number | null, currency: CurrencyCode): string {
  if (amount === null || Number.isNaN(amount)) return '—'

  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(amount)
  } catch {
    return `${currencySymbolMap[currency]}${amount.toFixed(currency === 'JPY' ? 0 : 2)}`
  }
}

export async function convertCurrency(amount: number, from: CurrencyCode, to: CurrencyCode): Promise<number> {
  if (from === to) return amount

  const now = Date.now()
  const cached = ratesCache.get(from)
  if (!cached || cached.expiresAt < now) {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      throw new Error(`FX rate fetch failed (${res.status})`)
    }
    const data = await res.json()
    if (!data?.rates) {
      throw new Error('FX response missing rates')
    }
    ratesCache.set(from, {
      rates: data.rates,
      expiresAt: now + 1000 * 60 * 15,
    })
  }

  const rate = ratesCache.get(from)?.rates?.[to]
  if (!rate) throw new Error(`FX rate missing ${from}->${to}`)
  return amount * rate
}
