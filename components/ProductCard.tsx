'use client'
import { useMemo, useState } from 'react'
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

function isStartingPriceMetric(metric: string | null | undefined): boolean {
  if (!metric) return false
  return /lowprice|minprice|startingprice|pricefrom|fromprice|offeraggregate|:from\b/i.test(metric)
}

function formatCandidatePrice(amount: number, currency: string, metric: string | null | undefined): string {
  const normalizedCurrency = normalizeCurrencyCode(currency)
  if (!isStartingPriceMetric(metric)) {
    return formatMoney(amount, normalizedCurrency)
  }

  const decimals = normalizedCurrency === 'JPY' ? 0 : 2
  const value = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(amount)

  return `${value}+ ${normalizedCurrency}`
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
  marketPosition?: 'cheapest' | 'competitive' | 'overpriced' | 'no_data'
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
  onPendingCurrencyChange: (competitorId: string, currency: string) => void
  onPendingDecimalShift: (competitorId: string, decimalShift: number) => void
  onConfirmPrice: (competitorId: string, includesVat: boolean) => void
  onRejectPrice: (competitorId: string) => void
}

function PriceHistoryChart({ history, currency }: { history: PriceHistory[]; currency: string }) {
  const [zoomDays, setZoomDays] = useState(30)

  const last30Days = useMemo(() => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000)
    return [...history]
      .filter(entry => new Date(entry.checked_at).getTime() >= cutoff)
      .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
  }, [history])

  // Need at least 1 point to render anything
  if (last30Days.length < 1) return null

  const fmt = normalizeCurrencyCode(currency)

  // Single data point — show a simple price badge, no chart
  if (last30Days.length === 1) {
    const single = last30Days[0]
    return (
      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 font-medium">Price recorded</span>
          <span className="text-xs font-bold text-gray-700">
            {formatMoney(single.price, fmt)}
          </span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {new Date(single.checked_at).toLocaleString()} · Refresh again to start building history
        </p>
      </div>
    )
  }

  const zoomedCutoff = Date.now() - (zoomDays * 24 * 60 * 60 * 1000)
  const sorted = last30Days.filter(entry => new Date(entry.checked_at).getTime() >= zoomedCutoff)

  // Not enough points in the zoom window — fall back to all available
  const chartData = sorted.length >= 2 ? sorted : last30Days

  const prices = chartData.map(h => h.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = 460
  const H = 160
  const padX = 34
  const padY = 16

  const points = chartData.map((h, i) => {
    const x = padX + (i / (chartData.length - 1)) * (W - padX * 2)
    const y = H - padY - ((h.price - min) / range) * (H - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const latest = chartData[chartData.length - 1]
  const prev = chartData[chartData.length - 2]
  const trending = latest.price < prev.price ? 'down' : latest.price > prev.price ? 'up' : 'flat'
  const color = trending === 'down' ? '#16a34a' : trending === 'up' ? '#dc2626' : '#6b7280'

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <span className="text-xs text-gray-500 font-medium">Price history (last 30 days · {chartData.length} checks)</span>
        <span className="text-xs font-bold" style={{ color }}>
          {trending === 'down' ? '↓' : trending === 'up' ? '↑' : '→'} {formatMoney(latest.price, fmt)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
        <defs>
          <linearGradient id={`grad-${currency}-${zoomDays}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#e5e7eb" strokeWidth="1" />
        <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#e5e7eb" strokeWidth="1" />
        <polyline points={`${padX},${H - padY} ${points} ${W - padX},${H - padY}`} fill={`url(#grad-${currency}-${zoomDays})`} stroke="none" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {(() => {
          const last = points.split(' ').at(-1)?.split(',')
          if (!last) return null
          return <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
        })()}
      </svg>
      <div className="mt-2">
        <label className="text-[11px] text-gray-500 flex items-center justify-between gap-2">
          <span>Zoom window</span>
          <span className="font-semibold text-gray-700">{zoomDays} days</span>
        </label>
        <input
          type="range"
          min={7}
          max={30}
          step={1}
          value={zoomDays}
          onChange={(event) => setZoomDays(Number(event.target.value))}
          className="mt-1 w-full accent-black"
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
        <span>{new Date(chartData[0].checked_at).toLocaleDateString()}</span>
        <span>{new Date(latest.checked_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

export default function ProductCard({
  product, marketPosition = 'no_data', isExpanded, onToggle, onEditProduct, onAddCompetitor, onEditCompetitor, onRefreshCompetitor,
  onCurrencyUpdated, competitorLimit, showVat, vatRate, competitorVatIncluded,
  fetchingIds, pendingPrices, onPendingVatIncludedChange, onPendingMetricChange, onPendingCurrencyChange, onPendingDecimalShift, onConfirmPrice, onRejectPrice,
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
  const productVatIncluded = product.vat_included ?? false
  const ourPrice = product.our_price !== null
    ? (showVat
      ? (productVatIncluded ? product.our_price : applyVat(product.our_price, vatRate))
      : (productVatIncluded ? removeVat(product.our_price, vatRate) : product.our_price))
    : null

  const marketPositionStyle = marketPosition === 'cheapest'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : marketPosition === 'competitive'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : marketPosition === 'overpriced'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-gray-100 text-gray-600 border-gray-200'

  const marketPositionLabel = marketPosition === 'cheapest'
    ? 'Cheapest'
    : marketPosition === 'competitive'
      ? 'Competitive'
      : marketPosition === 'overpriced'
        ? 'Overpriced'
        : 'No data'

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
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 sm:px-4 py-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors">
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
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${marketPositionStyle}`}>
              Market position: {marketPositionLabel}
            </span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 shrink-0">
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
        <div className="sm:hidden flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEditProduct(product) }}
            className="text-gray-400 hover:text-black transition-colors text-sm"
            title="Edit product"
            aria-label={`Edit ${product.title}`}
          >✏️</button>
          <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-3 space-y-2">
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

            // ── Price display logic ──────────────────────────────────────────
            // Priority: confirmed last_price → pending price (fetched but not yet confirmed)
            // This ensures "No price yet" never shows when a price was just fetched
            const confirmedPrice = comp.last_price !== null
              ? (showVat
                ? (includesVat ? comp.last_price : applyVat(comp.last_price, vatRate))
                : (includesVat ? removeVat(comp.last_price, vatRate) : comp.last_price))
              : null

            // Fallback: use the pending price if last_price is still null
            // (happens for newly added competitors mid-confirmation flow)
            const pendingDisplayPrice = (confirmedPrice === null && pending)
              ? (showVat ? applyVat(pending.price, vatRate) : pending.price)
              : null

            const priceWithVat = confirmedPrice ?? pendingDisplayPrice
            const isPendingPreview = confirmedPrice === null && pendingDisplayPrice !== null

            const cheaper = priceWithVat !== null && ourPrice !== null && priceWithVat < ourPrice
            const mapFloor = product.map_enabled && product.map_floor_price 
              ? product.map_floor_price 
              : null
            
            // Use the raw stored price for MAP comparison (not VAT-adjusted)
            const rawCompPrice = comp.last_price
            const isMapViolation = mapFloor !== null && rawCompPrice !== null && rawCompPrice < mapFloor
            const historyPoints = comp.price_history ?? []
            // Show history button with 1+ entries (chart handles single-point case)
            const hasHistory = historyPoints.length >= 1
            const showHistory = !!expandedHistory[comp.id]
            const compCurrency = normalizeCurrencyCode(comp.last_price_currency || productCurrency)
            const activeMetric = pending?.metricUsed ?? pending?.selectedMetric ?? comp.selected_price_metric
            const stockStatus = comp.last_stock_status ?? 'unknown'
            const stockBadgeClass = stockStatus === 'in_stock'
              ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
              : stockStatus === 'out_of_stock'
                ? 'bg-rose-100 border-rose-200 text-rose-700'
                : 'bg-gray-100 border-gray-200 text-gray-600'
            const stockLabel = stockStatus === 'in_stock'
              ? 'In stock'
              : stockStatus === 'out_of_stock'
                ? 'Out of stock'
                : 'Stock unknown'

            let hostname = comp.url
            try { hostname = new URL(comp.url).hostname } catch { /* keep raw */ }

            return (
              <div key={comp.id} className="space-y-1.5">
                <div className={`rounded-xl border overflow-hidden ${
                  isFetching ? 'bg-blue-50 border-blue-100'
                  : changed ? 'bg-red-50 border-red-100'
                  : 'bg-gray-50 border-gray-100'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-3">
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
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-1.5 w-full sm:w-auto">
                      <div className="flex items-center gap-1.5 order-2 sm:order-1">
                        {hasHistory && !isFetching && (
                          <button
                            onClick={() => setExpandedHistory(prev => ({ ...prev, [comp.id]: !prev[comp.id] }))}
                            className="w-8 h-8 rounded-md border border-gray-200 text-xs text-gray-500 hover:text-black hover:border-gray-400 transition-colors"
                            title="Toggle price history"
                          >
                            {showHistory ? '📉' : '📈'}
                          </button>
                        )}
                        <button
                          onClick={() => onRefreshCompetitor(comp.id)}
                          disabled={isFetching}
                          className="w-8 h-8 rounded-md border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Re-fetch price"
                        >
                          {isFetching ? (
                            <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          ) : '↻'}
                        </button>
                        <button
                          onClick={() => onEditCompetitor(comp)}
                          className="w-8 h-8 rounded-md border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400 transition-colors text-sm"
                          title="Edit competitor"
                        >✏️</button>
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded-md border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400 transition-colors text-sm inline-flex items-center justify-center"
                          title="Open competitor product page"
                        >↗</a>
                      </div>

                      {/* Price display in header */}
                      {!isFetching && priceWithVat !== null ? (
                        <div className="text-left sm:text-right shrink-0 order-1 sm:order-2">
                          {saleActive && (
                            <div className="mb-0.5">
                              <span className="inline-flex items-center rounded-md bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-700">
                                SALE
                              </span>
                            </div>
                          )}
                          <div className={`text-base font-extrabold tabular-nums ${
                            isPendingPreview
                              ? 'text-amber-600'  // pending-preview: amber instead of green/red
                              : cheaper ? 'text-red-500' : 'text-green-600'
                          }`}>
                            {formatCandidatePrice(priceWithVat, compCurrency, activeMetric)}
                            {isPendingPreview && (
                              <span className="ml-1 text-[10px] font-normal text-amber-500">?</span>
                            )}
                          </div>
                          {!isPendingPreview && (
                            <div className={`text-xs font-semibold ${
                              isMapViolation 
                                ? 'text-red-600' 
                                : cheaper ? 'text-red-400' : 'text-green-500'
                            }`}>
                              {isMapViolation ? '⚠ MAP VIOLATION' : cheaper ? 'CHEAPER' : 'HIGHER'}
                            </div>
                          )}
                          {isPendingPreview && (
                            <div className="text-[10px] text-amber-500 font-medium">Confirm below</div>
                          )}
                          <div className="mt-1">
                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${stockBadgeClass}`}>
                              {stockLabel}
                            </span>
                          </div>
                          {vatRate > 0 && (
                            <div className="text-[10px] text-gray-400">{showVat ? `incl. ${vatRate}% VAT` : `excl. ${vatRate}% VAT`}</div>
                          )}
                        </div>
                      ) : !isFetching ? (
                        <span className="text-xs text-gray-400 shrink-0 order-1 sm:order-2">No price yet</span>
                      ) : null}
                    </div>
                  </div>

                  {showHistory && historyPoints.length >= 1 && (
                    <div className="px-4 pb-3 border-t border-gray-100/80">
                      <PriceHistoryChart history={historyPoints} currency={comp.last_price_currency || productCurrency} />
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

                        <div className="text-lg font-extrabold text-gray-900">
                          {formatCandidatePrice(pending.price, pending.currency, pending.metricUsed ?? pending.selectedMetric)}
                          {vatRate > 0 && (
                            <span className="text-xs font-normal text-gray-400 ml-1">
                              {pending.includesVat ? 'includes VAT' : 'excludes VAT'}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-xs text-gray-700">Fetched currency:</label>
                          <select
                            value={normalizeCurrencyCode(pending.currency)}
                            onChange={(e) => onPendingCurrencyChange(comp.id, e.target.value)}
                            className="text-xs border border-amber-300 rounded-md px-2 py-1 outline-none focus:border-amber-500 bg-white"
                          >
                            {SUPPORTED_CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
                          </select>
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

                        {/* ── Decimal position ─────────────────────────────────── */}
<div className="mt-3 rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2">
  <div className="text-[11px] font-semibold text-amber-800 mb-0.5">
    Decimal position
  </div>
  <div className="text-[10px] text-amber-600 mb-1.5">
    💾 Saved — applied automatically on every future fetch
  </div>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => onPendingDecimalShift(comp.id, pending.decimalShift + 1)}
      className="text-xs font-semibold border border-amber-300 text-amber-700 px-2.5 py-1 rounded-md hover:bg-amber-100 transition-colors"
      title="Divide by 10 (move decimal left)"
    >
      ÷10
    </button>
    <button
      type="button"
      onClick={() => onPendingDecimalShift(comp.id, pending.decimalShift - 1)}
      className="text-xs font-semibold border border-amber-300 text-amber-700 px-2.5 py-1 rounded-md hover:bg-amber-100 transition-colors"
      title="Multiply by 10 (move decimal right)"
    >
      ×10
    </button>
    {pending.decimalShift !== 0 && (
      <button
        type="button"
        onClick={() => onPendingDecimalShift(comp.id, 0)}
        className="text-xs font-semibold border border-gray-300 text-gray-600 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
      >
        Reset
      </button>
    )}
    <span className="text-[11px] text-gray-500">
      {pending.decimalShift === 0
        ? 'no adjustment'
        : pending.decimalShift > 0
          ? `÷${Math.pow(10, pending.decimalShift).toLocaleString()} (${pending.rawPrice} → ${pending.price})`
          : `×${Math.pow(10, -pending.decimalShift).toLocaleString()} (${pending.rawPrice} → ${pending.price})`}
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
                      <div className="flex gap-2 shrink-0 self-start mt-1 sm:mt-0 w-full sm:w-auto">
                        <button
                          onClick={() => onRejectPrice(comp.id)}
                          className="text-xs font-semibold text-gray-500 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors flex-1 sm:flex-none"
                        >✕ Wrong</button>
                        <button
                          onClick={() => onConfirmPrice(comp.id, pending.includesVat)}
                          className="text-xs font-semibold text-white bg-black px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors flex-1 sm:flex-none"
                        >✓ Correct</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={onAddCompetitor}
              disabled={atLimit}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 active:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {atLimit ? `Competitor limit reached (${competitorLimit})` : '+ Add competitor URL'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
