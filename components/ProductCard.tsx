'use client'
import { useState } from 'react'
import { Product, CompetitorUrl, PriceHistory } from '@/types'
import { formatMoney, SUPPORTED_CURRENCIES, normalizeCurrencyCode } from '@/lib/currency'
import { applyVat, removeVat } from '@/lib/vat'

interface ScrapedCandidate {
  metric: string
  source: string
  price: number
  currency: string
  confidence?: number
}
interface PendingPrice {
  rawPrice: number
  price: number
  currency: string
  includesVat: boolean
  candidates: ScrapedCandidate[]
  selectedMetric: string | null
  decimalShift: number
  metricUsed: string | null
  matchedPreferredMetric: boolean
  scrapeStatus: 'matched' | 'fallback' | 'needs_review'
}

interface GroupedCandidate extends ScrapedCandidate {
  metrics: string[]
  confidenceScore?: number
}

function groupCandidatesByValue(candidates: ScrapedCandidate[]): GroupedCandidate[] {
  const grouped = new Map<string, GroupedCandidate>()

  for (const candidate of candidates) {
    const currency = normalizeCurrencyCode(candidate.currency)
    const key = `${currency}:${candidate.price.toFixed(4)}`
    const existing = grouped.get(key)

    if (existing) {
      existing.metrics.push(candidate.metric)
      continue
    }

    grouped.set(key, {
      ...candidate,
      currency,
      metrics: [candidate.metric],
    })
  }

  return Array.from(grouped.values()).map((candidate) => {
    const confidenceScore = Math.min(0.99, 0.45 + (candidate.metrics.length * 0.15))
    return { ...candidate, confidenceScore }
  })
}

function isSaleMetric(metric: string | null | undefined): boolean {
  if (!metric) return false
  return /sale|discount|redprice|nowprice|currentprice|campaign/i.test(metric)
}

function statusBadgeClass(status: PendingPrice['scrapeStatus']) {
  if (status === 'matched') return 'bg-green-100 text-green-700 border-green-200'
  if (status === 'fallback') return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

interface ConvertedCurrencyResponse {
  product?: { id: string; currency_code: string; our_price: number | null }
  competitors?: { id: string; last_price: number | null; last_price_currency: string | null }[]
}

interface Props {
  product: Product
  isExpanded: boolean
  onToggle: () => void
  onEditProduct: (product: Product) => void
  onAddCompetitor: () => void
  onEditCompetitor: (competitor: CompetitorUrl) => void
  onRefreshCompetitor: (competitorId: string) => void
  onCurrencyUpdated: (productId: string, currencyCode: string, converted?: ConvertedCurrencyResponse) => void
  competitorLimit: number
  showVat: boolean
  vatRate: number
  competitorVatIncluded: Record<string, boolean>
  fetchingIds: Record<string, boolean>
  pendingPrices: Record<string, PendingPrice>
  onPendingVatIncludedChange: (competitorId: string, includesVat: boolean) => void
  onPendingMetricChange: (competitorId: string, metric: string) => void
  onPendingDecimalShift: (competitorId: string, decimalShift: number) => void
  onConfirmPrice: (competitorId: string, includesVat: boolean) => void
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
        <defs>
          <linearGradient id={`grad-${currency}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={`${pad},${H} ${points} ${W - pad},${H}`} fill={`url(#grad-${currency})`} stroke="none" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  product, isExpanded, onToggle, onEditProduct, onAddCompetitor, onEditCompetitor, onRefreshCompetitor,
  onCurrencyUpdated, competitorLimit, showVat, vatRate, competitorVatIncluded,
  fetchingIds, pendingPrices, onPendingVatIncludedChange, onPendingMetricChange, onPendingDecimalShift, onConfirmPrice, onRejectPrice,
}: Props) {
  const competitors = product.competitor_urls ?? []
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})

  const hasChanges = competitors.some(c => {
    if (!c.last_changed_at) return false
    return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
  })
  const hasFetching = competitors.some(c => fetchingIds[c.id])
  const atLimit = competitorLimit !== Infinity && competitors.length >= competitorLimit
  const productCurrency = product.currency_code ?? 'USD'
  const ourPrice = product.our_price !== null ? applyVat(product.our_price, showVat ? vatRate : 0) : null

  const handleCurrencyChange = async (currencyCode: string) => {
    const res = await fetch('/api/products/currency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, currencyCode }),
    })
    if (!res.ok) return
    const data = await res.json()
    onCurrencyUpdated(product.id, currencyCode, data)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors">
        <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden shrink-0">
          {product.image_url
            ? <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight truncate">{product.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {ourPrice !== null && (
              <span className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-200 px-2 py-0.5 text-sm font-extrabold text-blue-700">
                Your price: {formatMoney(ourPrice, normalizeCurrencyCode(productCurrency))}
              </span>
            )}
            <span className="text-xs text-gray-500 leading-tight">
              {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} tracked
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-gray-300 text-sm" title="Drag to reorder">⋮⋮</span>
          <button
            onClick={(e) => { e.stopPropagation(); onEditProduct(product) }}
            className="text-gray-400 hover:text-black transition-colors text-sm"
            title="Edit product"
          >✏️</button>
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
        <div className="border-t border-gray-100 px-3 pb-3 pt-3 space-y-2">
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
            const groupedCandidates = pending ? groupCandidatesByValue(pending.candidates) : []
            const topCandidates = groupedCandidates
              .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
              .slice(0, 3)
            const changed = comp.last_changed_at && new Date(comp.last_changed_at) > new Date(Date.now() - 86400000)
            const includesVat = competitorVatIncluded[comp.id] ?? comp.vat_included ?? true
            const saleActive = isSaleMetric(pending?.selectedMetric ?? comp.selected_price_metric)
            const priceWithVat = comp.last_price !== null
              ? (showVat ? (includesVat ? comp.last_price : applyVat(comp.last_price, vatRate)) : (includesVat ? removeVat(comp.last_price, vatRate) : comp.last_price))
              : null
            const cheaper = priceWithVat !== null && ourPrice !== null && priceWithVat < ourPrice
            const historyPoints = comp.price_history ?? []
            const showHistory = !!expandedHistory[comp.id]
            const compCurrency = normalizeCurrencyCode(comp.last_price_currency || productCurrency)
            const matchConfidence = typeof comp.match_confidence === 'number' ? comp.match_confidence : null
            const mismatchReasons = Array.isArray(comp.mismatch_reasons) ? comp.mismatch_reasons : []
            const showMismatchWarning = matchConfidence !== null && (matchConfidence < 0.45 || mismatchReasons.length > 0)

            let hostname = comp.url
            try { hostname = new URL(comp.url).hostname } catch { /* keep raw */ }

            return (
              <div key={comp.id} className="space-y-1.5">
                <div className={`rounded-xl border overflow-hidden ${
                  isFetching ? 'bg-blue-50 border-blue-100'
                  : changed ? 'bg-red-50 border-red-100'
                  : 'bg-gray-50 border-gray-100'
                }`}>
                  <div className="flex items-center gap-2 px-3 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold leading-tight truncate max-w-[140px] sm:max-w-none">{comp.label || hostname}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {isFetching ? 'Fetching price…'
                          : comp.last_checked_at
                          ? `Checked ${new Date(comp.last_checked_at).toLocaleString()}`
                          : 'Never checked'}
                      </div>
                      {pending && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(pending.scrapeStatus)}`}>
                            {pending.scrapeStatus}
                          </span>
                          {pending.scrapeStatus === 'fallback' && comp.selected_price_metric && (
                            <span className="text-[10px] text-amber-700">
                              Fallback used: preferred metric {comp.selected_price_metric}
                            </span>
                          )}
                        </div>
                      )}
                      {showMismatchWarning && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                          <div className="font-semibold">Potential product mismatch ({Math.round((matchConfidence ?? 0) * 100)}% confidence)</div>
                          {mismatchReasons.length > 0 && <div className="mt-0.5">{mismatchReasons[0]}</div>}
                        </div>
                      )}
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

                    {/* Refresh button */}
                    <button
                      onClick={() => onRefreshCompetitor(comp.id)}
                      disabled={isFetching}
                      className="text-gray-400 hover:text-black transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Re-fetch price"
                    >
                      {isFetching ? (
                        <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      ) : '↻'}
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => onEditCompetitor(comp)}
                      className="text-gray-400 hover:text-black transition-colors text-sm"
                      title="Edit competitor"
                    >✏️</button>

                    <a
                      href={comp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-black transition-colors text-sm"
                      title="Open competitor product page"
                    >↗</a>

                    {/* Price display */}
                    {!isFetching && priceWithVat !== null ? (
                      <div className="text-right shrink-0">
                        {saleActive && (
                          <div className="mb-0.5">
                            <span className="inline-flex items-center rounded-md bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-700">
                              SALE
                            </span>
                          </div>
                        )}
                        <div className={`text-base font-extrabold tabular-nums ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                          {formatMoney(priceWithVat, compCurrency)}
                        </div>
                        <div className={`text-xs font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                          {cheaper ? 'CHEAPER' : 'HIGHER'}
                        </div>
                        {vatRate > 0 && (
                          <div className="text-[10px] text-gray-400">{showVat ? `incl. ${vatRate}% VAT` : `excl. ${vatRate}% VAT`}</div>
                        )}
                      </div>
                    ) : !isFetching ? (
                      <span className="text-xs text-gray-400 shrink-0">No price yet</span>
                    ) : null}
                  </div>

                  {showHistory && historyPoints.length >= 2 && (
                    <div className="px-4 pb-3 border-t border-gray-100/80">
                      <Sparkline history={historyPoints} currency={comp.last_price_currency || productCurrency} />
                    </div>
                  )}
                </div>

                {/* Pending price confirmation */}
                {pending && !isFetching && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 sm:px-4 py-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-amber-700 mb-1">
                          ✓ Price fetched — does this look right?
                          {pending.currency !== productCurrency && (
                            <span className="ml-1 text-amber-600 font-normal">
                              (will be converted to {productCurrency})
                            </span>
                          )}
                        </div>

                        {/*
                          Always show the raw fetched price here.
                          The VAT checkbox below only records *whether* this price
                          already includes VAT — it must not change this number.
                        */}
                        <div className="text-lg font-extrabold text-gray-900">
                          {formatMoney(pending.price, normalizeCurrencyCode(pending.currency))}
                          {vatRate > 0 && (
                            <span className="text-xs font-normal text-gray-400 ml-1">
                              {pending.includesVat ? 'includes VAT' : 'excludes VAT'}
                            </span>
                          )}
                        </div>

                        {vatRate > 0 && (
                          <label className="inline-flex items-center gap-2 mt-1.5 text-xs text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={pending.includesVat}
                              onChange={(e) => onPendingVatIncludedChange(comp.id, e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            VAT included in fetched price
                          </label>
                        )}

                        <div className="mt-3 rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2">
                          <div className="text-[11px] font-semibold text-amber-800 mb-1">
                            Decimal position
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onPendingDecimalShift(comp.id, pending.decimalShift + 1)}
                              className="text-xs font-semibold border border-amber-300 text-amber-700 px-2.5 py-1 rounded-md hover:bg-amber-100 transition-colors"
                              title="Move decimal one step to the left"
                            >
                              Modify
                            </button>
                            {pending.decimalShift !== 0 && (
                              <button
                                type="button"
                                onClick={() => onPendingDecimalShift(comp.id, 0)}
                                className="text-xs font-semibold border border-gray-300 text-gray-600 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
                                title="Reset decimal position"
                              >
                                Reset
                              </button>
                            )}
                            <span className="text-[11px] text-gray-500">
                              shift: {pending.decimalShift}
                            </span>
                          </div>
                        </div>

                        {topCandidates.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            <div className="text-[11px] font-semibold text-amber-800">
                              Top candidates (pick one tracking metric and it stays locked for future checks):
                            </div>
                            <div className="space-y-1">
                              {topCandidates.map((candidate, idx) => (
                                <label
                                  key={candidate.metric}
                                  className="flex items-center justify-between gap-3 text-xs rounded-lg border border-amber-200/80 px-2.5 py-1.5 bg-white/70 cursor-pointer"
                                >
                                  <span className="inline-flex items-start gap-2">
                                    <input
                                      type="radio"
                                      name={`metric-${comp.id}`}
                                      checked={pending.selectedMetric ? candidate.metrics.includes(pending.selectedMetric) : false}
                                      onChange={() => onPendingMetricChange(comp.id, candidate.metric)}
                                    />
                                    <span>
                                      <span className="font-medium text-gray-800 block">
                                        #{idx + 1} {formatMoney(candidate.price, normalizeCurrencyCode(candidate.currency))}
                                      </span>
                                      <span className="text-[10px] text-gray-600 block">Source: {candidate.source}</span>
                                      <span className="text-[10px] text-gray-600 block">Metric path: {candidate.metric}</span>
                                      <span className="text-[10px] text-gray-600 block">Detected currency: {candidate.currency}</span>
                                      <span className="text-[10px] text-gray-600 block">Confidence: {((candidate.confidenceScore ?? 0) * 100).toFixed(0)}%</span>
                                    </span>
                                  </span>
                                  {pending.metricUsed === candidate.metric && (
                                    <span className="text-[10px] font-semibold text-green-700">used</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0 self-start mt-1 sm:mt-0">
                        <button
                          onClick={() => onRejectPrice(comp.id)}
                          className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                        >✕ Wrong</button>
                        <button
                          onClick={() => onConfirmPrice(comp.id, pending.includesVat)}
                          className="text-xs font-semibold text-white bg-black px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                        >✓ Correct</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button
            onClick={onAddCompetitor}
            disabled={atLimit}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 active:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {atLimit ? `Competitor limit reached (${competitorLimit})` : '+ Add competitor URL'}
          </button>
        </div>
      )}
    </div>
  )
}
