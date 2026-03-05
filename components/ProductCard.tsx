import { useEffect, useMemo, useState } from 'react'
import { Product, CompetitorUrl } from '@/types'
import { formatMoney, SUPPORTED_CURRENCIES, normalizeCurrencyCode } from '@/lib/currency'
import { applyVat, detectUserCountryCode, getVatRateForCountry } from '@/lib/vat'

interface Props {
  product: Product
  isExpanded: boolean
  onToggle: () => void
  onAddCompetitor: () => void
  onEditCompetitor: (competitor: CompetitorUrl) => void
  onCurrencyUpdated: (productId: string, currencyCode: string) => void
  competitorLimit: number
  showVat: boolean
}

export default function ProductCard({ product, isExpanded, onToggle, onAddCompetitor, onEditCompetitor, onCurrencyUpdated, competitorLimit, showVat }: Props) {
  const competitors = product.competitor_urls ?? []
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null)
  const hasChanges = competitors.some(c => {
    if (!c.last_changed_at) return false
    return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
  })
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

    if (res.ok) {
      onCurrencyUpdated(product.id, currencyCode)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors">
        <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">
          {product.image_url ? <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{product.title}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {ourPrice ? `Your price: ${formatMoney(ourPrice, normalizeCurrencyCode(productCurrency))} · ` : ''}
            {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} tracked
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasChanges && <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">Price changed!</span>}
          <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-5 pb-4 pt-3 space-y-2">
          <div className="pb-2">
            <label className="text-xs text-gray-500 mr-2">Product currency:</label>
            <select
              value={productCurrency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1"
            >
              {SUPPORTED_CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          {competitors.length === 0 && <p className="text-sm text-gray-400 py-2">No competitors added yet.</p>}

          {competitors.map(comp => {
            const changed = comp.last_changed_at && new Date(comp.last_changed_at) > new Date(Date.now() - 86400000)
            const priceWithVat = comp.last_price !== null ? applyVat(comp.last_price, showVat ? vatRate : 0) : null
            const cheaper = priceWithVat !== null && ourPrice !== null && priceWithVat < ourPrice

            return (
              <div key={comp.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${changed ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{comp.label || new URL(comp.url).hostname}</div>
                  <div className="text-xs text-gray-400 mt-0.5">Checked {comp.last_checked_at ? new Date(comp.last_checked_at).toLocaleString() : 'never'}</div>
                </div>

                <button
                  onClick={() => onEditCompetitor(comp)}
                  className="mr-3 text-sm text-gray-500 hover:text-black transition-colors"
                  aria-label="Edit competitor"
                  title="Edit competitor"
                >
                  ✏️
                </button>

                {priceWithVat !== null ? (
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>{formatMoney(priceWithVat, normalizeCurrencyCode(comp.last_price_currency || productCurrency))}</div>
                    <div className={`text-xs font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>{cheaper ? 'CHEAPER' : 'HIGHER'}</div>
                    {showVat && vatRate > 0 && userCountryCode && (
                      <div className="text-[10px] text-gray-400 mt-0.5">Incl. {vatRate}% VAT ({userCountryCode})</div>
                    )}
                  </div>
                ) : <span className="text-xs text-gray-400">Pending</span>}
              </div>
            )
          })}

          <button onClick={onAddCompetitor} disabled={atLimit} className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {atLimit ? `Competitor limit reached (${competitorLimit})` : '+ Add competitor URL'}
          </button>
        </div>
      )}
    </div>
  )
}
