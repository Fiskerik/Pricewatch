'use client'
import { useEffect, useMemo, useState } from 'react'
import { Product, CompetitorUrl, PriceHistory } from '@/types'
import { formatMoney, SUPPORTED_CURRENCIES, normalizeCurrencyCode } from '@/lib/currency'
import { applyVat, detectUserCountryCode, getVatRateForCountry } from '@/lib/vat'

interface PendingPrice { price: number; currency: string }

interface Props {
  product: Product
  isExpanded: boolean
  onToggle: () => void
  onAddCompetitor: () => void
  onEditCompetitor: (competitor: CompetitorUrl) => void
  onCurrencyUpdated: (productId: string, currencyCode: string) => void
  competitorLimit: number
  showVat: boolean
  fetchingIds: Record<string, boolean>
  pendingPrices: Record<string, PendingPrice>
  onConfirmPrice: (competitorId: string) => void
  onRejectPrice: (competitorId: string) => void
}

// ── Inline sparkline SVG ─────────────────────────────────────
function Sparkline({ history, currency }: { history: PriceHistory[]; currency: string }) {
  const sorted = [...history].sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
  if (sorted.length < 2) return null

  const prices = sorted.map(h => h.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = 160
  const H = 40
  const pad = 4

  const points = sorted.map((h, i) => {
    const x = pad + (i / (sorted.length - 1)) * (W - pad * 2)
    const y = H - pad - ((h.price - min) / range) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const latest = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  const trending = latest.price < prev.price ? 'down' : latest.price > prev.price ? 'up' : 'flat'
  const color = trending === 'down' ? '#16a34a' : trending === 'up' ? '#dc2626' : '#6b7280'

  const fmt = normalizeCurrencyCode(currency)

  return (
    <div className="mt-2 px-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-400 font-medium">Price history ({sorted.length} checks)</span>
        <span className="text-[10px] font-bold" style={{ color }}>
          {trending === 'down' ? '↓' : trending === 'up' ? '↑' : '→'} {formatMoney(latest.price, fmt)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
        {/* Subtle gradient fill */}
        <defs>
          <linearGradient id={`grad-${currency}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <polyline
          points={`${pad},${H} ${points} ${W - pad},${H}`}
          fill={`url(#grad-${currency})`}
          stroke="none"
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Latest dot */}
        {(() => {
          const last = points.split(' ').at(-1)?.split(',')
          if (!last) return null
          return <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
        })()}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{new Date(sorted[0].checked_at).toLocaleDateString()}</span>
        <span>{new Date(latest.checked_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

export default function ProductCard({
  product, isExpanded, onToggle, onAddCompetitor, onEditCompetitor,
  onCurrencyUpdated, competitorLimit, showVat,
  fetchingIds, pendingPrices, onConfirmPrice, onRejectPrice,
}: Props) {
  const competitors = product.competitor_urls ?? []
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})

  const hasChanges = competitors.some(c => {
    if (!c.last_changed_at) return false
    return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
  })
  const hasFetching = competitors.some(c => fetchingIds[c.id])
  const atLimit = competitorLimit !== Infinity && competitors.length >= competitorLimit
  const productCurrency = product.currency_code ?? 'USD'
  const vatRate = useMemo(() => getVatRateForCountry(userCountryCode), [userCountryCode])
  const ourPrice = product.our_price !== null ? applyVat(product.our_price, showVat ? vatRate : 0) : null

  useEffect(() => { setUserCountryCode(detectUserCountryCode()) }, [])

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
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors">
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
            <span className="bg-blue-50 text-blue-600 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Fetching…
            </span>
          )}
          {hasChanges && !hasFetching && (
            <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">Price changed!</span>
          )}
          <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-5 pb-4 pt-3 space-y-2">
          {/* Currency selector */}
          <div className="pb-1">
            <label className="text-xs text-gray-500 mr-2">Product currency:</label>
            <select
              value={productCurrency}
              onChange={e => handleCurrencyChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-black"
            >
              {SUPPORTED_CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          {competitors.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No competitors added yet.</p>
          )}

          {competitors.map(comp => {
            const isFetching = !!fetchingIds[comp.id]
            const pending = pendingPrices[comp.id]
            const changed = comp.last_changed_at && new Date(comp.last_changed_at) > new Date(Date.now() - 86400000)
            const priceWithVat = comp.last_price !== null ? applyVat(comp.last_price, showVat ? vatRate : 0) : null
            const cheaper = priceWithVat !== null && ourPrice !== null && priceWithVat < ourPrice
            const historyPoints = comp.price_history ?? []
            const showHistory = !!expandedHistory[comp.id]

            let hostname = comp.url
            try { hostname = new URL(comp.url).hostname } catch { /* keep raw */ }

            return (
              <div key={comp.id} className="space-y-1.5">
                {/* Main competitor row */}
                <div className={`rounded-xl border overflow-hidden ${
                  isFetching ? 'bg-blue-50 border-blue-100'
                  : changed ? 'bg-red-50 border-red-100'
                  : 'bg-gray-50 border-gray-100'
                }`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{comp.label || hostname}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {isFetching ? 'Fetching price…'
                          : comp.last_checked_at
                          ? `Checked ${new Date(comp.last_checked_at).toLocaleString()}`
                          : 'Never checked'}
                      </div>
                    </div>

                    {/* History toggle */}
                    {historyPoints.length >= 2 && !isFetching && (
                      <button
                        onClick={() => setExpandedHistory(prev => ({ ...prev, [comp.id]: !prev[comp.id] }))}
                        className="text-xs text-gray-400 hover:text-black transition-colors px-1"
                        title="Toggle price history"
                      >
                        {showHistory ? '📉' : '📈'}
                      </button>
                    )}

                    {/* Edit */}
                    <button
                      onClick={() => onEditCompetitor(comp)}
                      className="text-gray-400 hover:text-black transition-colors text-sm"
                      title="Edit competitor"
                    >
                      ✏️
                    </button>

                    {/* Price */}
                    {isFetching ? (
                      <span className="inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    ) : priceWithVat !== null ? (
                      <div className="text-right shrink-0">
                        <div className={`text-lg font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                          {formatMoney(priceWithVat, normalizeCurrencyCode(comp.last_price_currency || productCurrency))}
                        </div>
                        <div className={`text-xs font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                          {cheaper ? 'CHEAPER' : 'HIGHER'}
                        </div>
                        {showVat && vatRate > 0 && userCountryCode && (
                          <div className="text-[10px] text-gray-400">incl. {vatRate}% VAT</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 shrink-0">No price yet</span>
                    )}
                  </div>

                  {/* Sparkline — inline in card */}
                  {showHistory && historyPoints.length >= 2 && (
                    <div className="px-4 pb-3 border-t border-gray-100/80">
                      <Sparkline history={historyPoints} currency={comp.last_price_currency || productCurrency} />
                    </div>
                  )}
                </div>

                {/* Pending price confirmation */}
                {pending && !isFetching && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-amber-700 mb-0.5">✓ Price fetched — does this look right?</div>
                      <div className="text-lg font-extrabold text-gray-900">
                        {formatMoney(applyVat(pending.price, showVat ? vatRate : 0), normalizeCurrencyCode(pending.currency))}
                        {showVat && vatRate > 0 && (
                          <span className="text-xs font-normal text-gray-400 ml-1">incl. VAT</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => onRejectPrice(comp.id)}
                        className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
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
