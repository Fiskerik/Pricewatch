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
