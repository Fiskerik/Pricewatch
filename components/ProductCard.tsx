import { useEffect, useMemo, useState } from 'react'
import { Product, CompetitorUrl } from '@/types'
import { formatMoney, SUPPORTED_CURRENCIES, normalizeCurrencyCode } from '@/lib/currency'
import { applyVat, detectUserCountryCode, getVatRateForCountry } from '@/lib/vat'

interface PendingPrice {
  price: number
  currency: string
}

interface Props {
  product: Product
  isExpanded: boolean
  onToggle: () => void
  onAddCompetitor: () => void
  onEditCompetitor: (competitor: CompetitorUrl) => void
  onCurrencyUpdated: (productId: string, currencyCode: string) => void
  competitorLimit: number
  showVat: boolean
  fetchingIds: Set<string>
  pendingPrices: Map<string, PendingPrice>
  onConfirmPrice: (competitorId: string) => void
  onRejectPrice: (competitorId: string) => void
}

export default function ProductCard({
  product,
  isExpanded,
  onToggle,
  onAddCompetitor,
  onEditCompetitor,
  onCurrencyUpdated,
  competitorLimit,
  showVat,
  fetchingIds,
  pendingPrices,
  onConfirmPrice,
  onRejectPrice,
}: Props) {
  const competitors = product.competitor_urls ?? []
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null)

  const hasChanges = competitors.some(c => {
    if (!c.last_changed_at) return false
    return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
  })
  const hasFetching = competitors.some(c => fetchingIds.has(c.id))
  const atLimit = competitorLimit !== Infinity && competitors.length >= competitorLimit
  const productCurrency = product.currency_code ?? 'USD'
  const vatRate = useMemo(() => getVatRateForCountry(userCountryCode), [userCountryCode])
  const ourPrice = product.our_price !== null ? applyVat(product.our_price, showVat ? vatRate : 0) : null

  useEffect(() => {
    setUserCountryCode(detectUserCountryCode())
  }, [])

  const handleCurrencyChange = async (currencyCode: string) => {
    const res = await fetch('/api/products/currency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, currencyCode }),
    })
    if (res.ok) onCurrencyUpdated(product.id, currencyCode)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Product row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">
          {product.image_url
            ? <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{product.title}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {ourPrice ? `Your price: ${formatMoney(ourPrice, normalizeCurrencyCode(productCurrency))} · ` : ''}
            {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} tracked
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasFetching && (
            <span className="bg-blue-50 text-blue-600 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
              <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Fetching…
            </span>
          )}
          {hasChanges && !hasFetching && (
            <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">
              Price changed!
            </span>
          )}
          <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-5 pb-4 pt-3 space-y-2">
          {/* Currency selector */}
          <div className="pb-2">
            <label className="text-xs text-gray-500 mr-2">Product currency:</label>
            <select
              value={productCurrency}
              onChange={e => handleCurrencyChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1"
            >
              {SUPPORTED_CURRENCIES.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>

          {competitors.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No competitors added yet.</p>
          )}

          {competitors.map(comp => {
            const isFetching = fetchingIds.has(comp.id)
            const pending = pendingPrices.get(comp.id)
            const changed = comp.last_changed_at && new Date(comp.last_changed_at) > new Date(Date.now() - 86400000)
            const priceWithVat = comp.last_price !== null ? applyVat(comp.last_price, showVat ? vatRate : 0) : null
            const cheaper = priceWithVat !== null && ourPrice !== null && priceWithVat < ourPrice

            return (
              <div key={comp.id} className="space-y-1.5">
                {/* Main competitor row */}
                <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                  isFetching
                    ? 'bg-blue-50 border-blue-100'
                    : changed
                    ? 'bg-red-50 border-red-100'
                    : 'bg-gray-50 border-gray-100'
                }`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {comp.label || (() => { try { return new URL(comp.url).hostname } catch { return comp.url } })()}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {isFetching
                        ? 'Fetching price…'
                        : `Checked ${comp.last_checked_at ? new Date(comp.last_checked_at).toLocaleString() : 'never'}`
                      }
                    </div>
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => onEditCompetitor(comp)}
                    className="mr-1 text-sm text-gray-400 hover:text-black transition-colors"
                    aria-label="Edit"
                    title="Edit competitor"
                  >
                    ✏️
                  </button>

                  {/* Price display */}
                  {isFetching ? (
                    <div className="shrink-0">
                      <span className="inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : priceWithVat !== null ? (
                    <div className="text-right shrink-0">
                      <div className={`text-lg font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                        {formatMoney(priceWithVat, normalizeCurrencyCode(comp.last_price_currency || productCurrency))}
                      </div>
                      <div className={`text-xs font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                        {cheaper ? 'CHEAPER' : 'HIGHER'}
                      </div>
                      {showVat && vatRate > 0 && userCountryCode && (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          Incl. {vatRate}% VAT ({userCountryCode})
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">No price yet</span>
                  )}
                </div>

                {/* Pending price confirmation banner */}
                {pending && !isFetching && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-amber-700 mb-0.5">✓ Price fetched — confirm it's correct?</div>
                      <div className="text-lg font-extrabold text-gray-900">
                        {formatMoney(
                          applyVat(pending.price, showVat ? vatRate : 0),
                          normalizeCurrencyCode(pending.currency)
                        )}
                        {showVat && vatRate > 0 && (
                          <span className="text-xs font-normal text-gray-400 ml-1">incl. VAT</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => onRejectPrice(comp.id)}
                        className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                        title="Price looks wrong — clear it"
                      >
                        ✕ Wrong
                      </button>
                      <button
                        onClick={() => onConfirmPrice(comp.id)}
                        className="text-xs font-semibold text-white bg-black px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        ✓ Correct
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Add competitor button */}
          <button
            onClick={onAddCompetitor}
            disabled={atLimit}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {atLimit ? `Competitor limit reached (${competitorLimit})` : '+ Add competitor URL'}
          </button>
        </div>
      )}
    </div>
  )
}
