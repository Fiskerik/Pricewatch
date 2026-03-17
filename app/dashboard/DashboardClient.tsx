'use client'
import { useEffect, useState, useMemo } from 'react'
import { User } from '@supabase/supabase-js'
import Link from 'next/link'
import { Store, Product, CompetitorUrl, PLAN_LIMITS } from '@/types'
import Sidebar from '@/components/Sidebar'
import ProductCard from '@/components/ProductCard'
import AddCompetitorModal from '@/components/AddCompetitorModal'
import AddProductModal from '@/components/AddProductModal'
import AlertBadge from '@/components/AlertBadge'
import VatCountrySelector, { detectCountryCode, VAT_COUNTRIES } from '@/components/VatCountrySelector'
import { formatMoney, normalizeCurrencyCode } from '@/lib/currency'
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
type ViewMode = 'products' | 'competitors'
type ProductLayout = 'list' | 'grid'
type MarketPosition = 'cheapest' | 'competitive' | 'overpriced' | 'no_data' | 'map_violation'

interface Props {
  user: User
  store: Store | null
  initialProducts: Product[]
  initialAlerts: any[]
}

export default function DashboardClient({ user, store, initialProducts, initialAlerts }: Props) {
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [alerts] = useState(initialAlerts)
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({})
  const [addCompetitorFor, setAddCompetitorFor] = useState<string | null>(null)
  const [editingCompetitor, setEditingCompetitor] = useState<{ productId: string; competitor: CompetitorUrl } | null>(null)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  const [vatCountryCode, setVatCountryCode] = useState<string>('SE')
  const [vatRate, setVatRate] = useState<number>(25)
  const [showVat, setShowVat] = useState(true)

  const [viewMode, setViewMode] = useState<ViewMode>('products')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())
  const [productLayout, setProductLayout] = useState<ProductLayout>('list')
  const [draggingProductId, setDraggingProductId] = useState<string | null>(null)

  const [fetchingIds, setFetchingIds] = useState<Record<string, boolean>>({})
  const [pendingPrices, setPendingPrices] = useState<Record<string, PendingPrice>>({})
  const [preferredMetrics, setPreferredMetrics] = useState<Record<string, string>>({})
  const [decimalShifts, setDecimalShifts] = useState<Record<string, number>>({})

  const applyDecimalShift = (value: number, shift: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(shift) || shift === 0) return value
    const next = value / Math.pow(10, shift)
    return Math.round(next * 1000000) / 1000000
  }

  useEffect(() => {
    const storedCountry = window.localStorage.getItem('pricingspy:vatCountry')
    const code = storedCountry ?? detectCountryCode()
    const country = VAT_COUNTRIES.find(c => c.code === code) ?? VAT_COUNTRIES.find(c => c.code === 'SE')!
    setVatCountryCode(country.code)
    setVatRate(country.rate)

    const storedVat = window.localStorage.getItem('pricingspy:showVat')
    if (storedVat === 'false') setShowVat(false)

    const storedLayout = window.localStorage.getItem('pricingspy:productLayout')
    if (storedLayout === 'grid' || storedLayout === 'list') setProductLayout(storedLayout)

    const storedOrderRaw = window.localStorage.getItem('pricingspy:productOrder')
    if (storedOrderRaw) {
      try {
        const storedOrder: string[] = JSON.parse(storedOrderRaw)
        setProducts(prev => {
          const indexById = new Map(storedOrder.map((id, idx) => [id, idx]))
          return [...prev].sort((a, b) => {
            const aIdx = indexById.get(a.id)
            const bIdx = indexById.get(b.id)
            if (aIdx == null && bIdx == null) return 0
            if (aIdx == null) return 1
            if (bIdx == null) return -1
            return aIdx - bIdx
          })
        })
      } catch {}
    }

    const storedMetricsRaw = window.localStorage.getItem('pricingspy:preferredMetrics')
    if (storedMetricsRaw) {
      try {
        const parsed = JSON.parse(storedMetricsRaw) as Record<string, string>
        setPreferredMetrics(parsed)
      } catch {}
    }

    const storedDecimalShiftsRaw = window.localStorage.getItem('pricingspy:decimalShifts')
    if (storedDecimalShiftsRaw) {
      try {
        const parsed = JSON.parse(storedDecimalShiftsRaw) as Record<string, number>
        setDecimalShifts(parsed)
      } catch {}
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('pricingspy:productOrder', JSON.stringify(products.map(p => p.id)))
  }, [products])

  useEffect(() => {
    window.localStorage.setItem('pricingspy:preferredMetrics', JSON.stringify(preferredMetrics))
  }, [preferredMetrics])

  useEffect(() => {
    window.localStorage.setItem('pricingspy:decimalShifts', JSON.stringify(decimalShifts))
  }, [decimalShifts])

  const handleVatCountryChange = (code: string, rate: number) => {
    setVatCountryCode(code)
    setVatRate(rate)
    window.localStorage.setItem('pricingspy:vatCountry', code)
    const next = rate > 0
    setShowVat(next)
    window.localStorage.setItem('pricingspy:showVat', String(next))
  }

  const plan = store?.plan ?? 'free'
  const limits = PLAN_LIMITS[plan]
  const totalCompetitors = products.reduce((a, p) => a + (p.competitor_urls?.length ?? 0), 0)
  const changedToday = products.reduce((a, p) =>
    a + (p.competitor_urls?.filter(c => {
      if (!c.last_changed_at) return false
      return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
    }).length ?? 0), 0
  )

  const competitorGroups = useMemo(() => {
    const groups: Record<string, { domain: string; entries: { comp: CompetitorUrl; product: Product }[] }> = {}
    for (const product of products) {
      for (const comp of product.competitor_urls ?? []) {
        let domain = comp.url
        try { domain = new URL(comp.url).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
        if (!groups[domain]) groups[domain] = { domain, entries: [] }
        groups[domain].entries.push({ comp, product })
      }
    }
    return Object.values(groups).sort((a, b) => b.entries.length - a.entries.length)
  }, [products])

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products
    const q = searchQuery.toLowerCase()
    return products.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.competitor_urls ?? []).some(c =>
        (c.label ?? '').toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
      )
    )
  }, [products, searchQuery])

  const productMarketPosition = useMemo(() => {
    const map: Record<string, MarketPosition | 'map_violation'> = {}
    
    for (const product of products) {
      // 1. Check for MAP violations first
      const hasMapViolation = product.map_enabled === true &&
        product.map_floor_price != null &&
        (product.competitor_urls ?? []).some(c =>
          c.last_price !== null && c.last_price < product.map_floor_price!
        )
      
      if (hasMapViolation) {
        map[product.id] = 'map_violation'
        continue // This now correctly jumps to the next product in the loop
      }

      // 2. Proceed with normal price comparison logic
      const ourPrice = typeof product.our_price === 'number' && Number.isFinite(product.our_price) ? product.our_price : null
      const competitorPrices = (product.competitor_urls ?? [])
        .map(competitor => competitor.last_price)
        .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0)

      if (ourPrice == null || competitorPrices.length === 0) {
        map[product.id] = 'no_data'
        continue
      }

      const lowestCompetitor = Math.min(...competitorPrices)
      if (ourPrice <= lowestCompetitor) {
        map[product.id] = 'cheapest'
        continue
      }

      const diffPct = ((ourPrice - lowestCompetitor) / lowestCompetitor) * 100
      map[product.id] = diffPct <= 5 ? 'competitive' : 'overpriced'
    }

    return map
  }, [products])

  const marketSummary = useMemo(() => {
    const summary = { cheapest: 0, competitive: 0, overpriced: 0, no_data: 0, map_violation: 0 }
    for (const product of products) {
      const position = productMarketPosition[product.id] ?? 'no_data'
      summary[position] += 1
    }

    const considered = summary.cheapest + summary.competitive + summary.overpriced
    const leader = considered === 0
      ? 'No priced products yet'
      : summary.cheapest >= summary.competitive && summary.cheapest >= summary.overpriced
        ? 'Mostly cheapest'
        : summary.competitive >= summary.overpriced
          ? 'Mostly competitive'
          : 'Mostly overpriced'

    return { ...summary, leader }
  }, [products, productMarketPosition])

  const triggerBackgroundFetch = (competitorId: string) => {
    setFetchingIds(prev => ({ ...prev, [competitorId]: true }))
    fetch('/api/competitors/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId, preferredMetric: preferredMetrics[competitorId] ?? null }),
    })
      .then(async res => {
        if (!res.ok) return
        const data = await res.json()
        const comp = data.competitor
        const candidates = Array.isArray(data?.candidates) ? data.candidates as ScrapedCandidate[] : []
        const rankedCandidates = [...candidates].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        const candidateFallback = rankedCandidates[0] ?? null

        const scrapedPrice = typeof data?.scrapedPrice === 'number' ? data.scrapedPrice : null
        const scrapedCurrency = typeof data?.scrapedCurrency === 'string' ? data.scrapedCurrency : null

        if (scrapedPrice != null || candidateFallback) {
          const rawPrice = scrapedPrice ?? candidateFallback?.price
          if (rawPrice == null) return
          const savedDecimalShift = decimalShifts[competitorId] ?? 0
          const shiftedPrice = applyDecimalShift(rawPrice, savedDecimalShift)
          const selectedMetric =
            (typeof data?.metricUsed === 'string' && data.metricUsed)
            || preferredMetrics[competitorId]
            || comp?.selected_price_metric
            || candidateFallback?.metric
            || null

          const hasSavedMetric = Boolean(comp?.selected_price_metric || preferredMetrics[competitorId])
          const matchedPreferredMetric = Boolean(data?.matchedPreferredMetric)
          const scrapeStatus: PendingPrice['scrapeStatus'] =
            !selectedMetric ? 'needs_review' : hasSavedMetric
              ? (matchedPreferredMetric ? 'matched' : 'fallback')
              : 'needs_review'

          setPendingPrices(prev => ({
            ...prev,
            [competitorId]: {
              rawPrice,
              price: shiftedPrice,
              currency: scrapedCurrency ?? candidateFallback?.currency ?? comp?.last_price_currency ?? 'USD',
              includesVat: true,
              candidates,
              selectedMetric,
              decimalShift: savedDecimalShift,
              metricUsed: typeof data?.metricUsed === 'string' ? data.metricUsed : null,
              matchedPreferredMetric,
              scrapeStatus,
            },
          }))
        }

        if (comp) {
          setProducts(prev => prev.map(p => ({
            ...p,
            competitor_urls: (p.competitor_urls ?? []).map(c => c.id === competitorId ? { ...c, ...comp } : c),
          })))
        }
      })
      .catch(() => {})
      .finally(() => { setFetchingIds(prev => { const n = { ...prev }; delete n[competitorId]; return n }) })
  }

  const handlePendingDecimalShift = (competitorId: string, decimalShift: number) => {
    const safeShift = Number.isFinite(decimalShift) ? Math.max(-6, Math.min(6, Math.trunc(decimalShift))) : 0
    setPendingPrices(prev => {
      const current = prev[competitorId]
      if (!current) return prev
      return {
        ...prev,
        [competitorId]: {
          ...current,
          decimalShift: safeShift,
          price: applyDecimalShift(current.rawPrice, safeShift),
        },
      }
    })

    setDecimalShifts(prev => {
      const next = { ...prev }
      if (safeShift === 0) {
        delete next[competitorId]
      } else {
        next[competitorId] = safeShift
      }
      return next
    })
  }

  const handleConfirmPrice = async (id: string, includesVat: boolean) => {
    const pending = pendingPrices[id]
    const competitor = products.flatMap(p => p.competitor_urls ?? []).find(c => c.id === id)
    if (!pending || !competitor) {
      setPendingPrices(prev => { const n = { ...prev }; delete n[id]; return n })
      return
    }

    const finalPrice = pending.price
    const finalCurrency = (pending.currency || 'USD').toUpperCase()
    setProducts(prev => prev.map(p => ({
      ...p,
      competitor_urls: (p.competitor_urls ?? []).map(c =>
        c.id === id ? { ...c, last_price: finalPrice, last_price_currency: finalCurrency, last_checked_at: new Date().toISOString(), price_decimal_shift: pending.decimalShift, price_currency_override: pending.currency || null } : c
      ),
    })))

    setPendingPrices(prev => { const n = { ...prev }; delete n[id]; return n })

    if (pending.selectedMetric) {
      const selectedMetric = pending.selectedMetric
      setPreferredMetrics(prev => ({ ...prev, [id]: selectedMetric }))
    }

    await fetch('/api/competitors/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitorId: id,
        url: competitor.url,
        label: competitor.label,
        updatedPrice: finalPrice,
        updatedCurrency: finalCurrency,
        priceDecimalShift: pending.decimalShift,       
        priceCurrencyOverride: pending.currency || null, 
        selectedMetric: pending.selectedMetric,
      }),
    }).catch(() => {})
  }

  const handleRejectPrice = async (id: string) => {
    setPendingPrices(prev => { const n = { ...prev }; delete n[id]; return n })
    setProducts(prev => prev.map(p => ({
      ...p,
      competitor_urls: (p.competitor_urls ?? []).map(c =>
        c.id === id ? { ...c, last_price: null, last_checked_at: null } : c
      ),
    })))
    const comp = products.flatMap(p => p.competitor_urls ?? []).find(c => c.id === id)
    if (!comp) return
    await fetch('/api/competitors/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId: id, url: comp.url, updatedPrice: null }),
    }).catch(() => {})
  }

  const handleProductAdded = (product: Product) => {
    setProducts(prev => [product, ...prev])
    setExpandedProducts(prev => ({ ...prev, [product.id]: true }))
    setShowAddProduct(false)
  }

  const handleProductUpdated = (updated: Product) => {
    setProducts(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
    setEditingProduct(null)
  }

  const handleProductDeleted = (productId: string) => {
    setProducts(prev => prev.filter(product => product.id !== productId))
    setEditingProduct(null)
  }

  const handleCompetitorAdded = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : { ...p, competitor_urls: [...(p.competitor_urls ?? []), competitor] }
    ))
    setAddCompetitorFor(null)
    setExpandedProducts(prev => ({ ...prev, [productId]: true }))
    triggerBackgroundFetch(competitor.id)
  }



  const handleCompetitorUpdated = (productId: string, competitor: CompetitorUrl) => {
    const previous = products
      .find(p => p.id === productId)
      ?.competitor_urls
      ?.find(c => c.id === competitor.id)

    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : {
        ...p, competitor_urls: (p.competitor_urls ?? []).map(c => c.id === competitor.id ? competitor : c),
      }
    ))

    if (previous && previous.url !== competitor.url) {
      setDecimalShifts(prev => {
        const next = { ...prev }
        delete next[competitor.id]
        return next
      })
    }
  }

  const handleCompetitorDeleted = (productId: string, competitorId: string) => {
    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : { ...p, competitor_urls: (p.competitor_urls ?? []).filter(c => c.id !== competitorId) }
    ))
    setEditingCompetitor(null)
    setPendingPrices(prev => { const n = { ...prev }; delete n[competitorId]; return n })
    setFetchingIds(prev => { const n = { ...prev }; delete n[competitorId]; return n })
    setDecimalShifts(prev => { const n = { ...prev }; delete n[competitorId]; return n })
  }

  const handleToggleCompetitorAlert = async (competitorId: string, isActive: boolean) => {
    const competitor = products.flatMap(p => p.competitor_urls ?? []).find(c => c.id === competitorId)
    if (!competitor) return

    setProducts(prev => prev.map(product => ({
      ...product,
      competitor_urls: (product.competitor_urls ?? []).map(c =>
        c.id === competitorId ? { ...c, is_active: isActive } : c,
      ),
    })))

    const response = await fetch('/api/competitors/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitorId,
        url: competitor.url,
        label: competitor.label,
        isActive,
      }),
    }).catch(() => null)

    if (!response?.ok) {
      setProducts(prev => prev.map(product => ({
        ...product,
        competitor_urls: (product.competitor_urls ?? []).map(c =>
          c.id === competitorId ? { ...c, is_active: !isActive } : c,
        ),
      })))
    }
  }

  const handleProductCurrencyUpdated = (productId: string, currencyCode: string, converted?: {
    product?: { id: string; currency_code: string; our_price: number | null }
    competitors?: { id: string; last_price: number | null; last_price_currency: string | null }[]
  }) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      const convertedById = new Map((converted?.competitors ?? []).map(c => [c.id, c]))
      const convertedProduct = converted?.product

      return {
        ...p,
        currency_code: convertedProduct?.currency_code ?? currencyCode,
        our_price: convertedProduct?.our_price ?? p.our_price,
        competitor_urls: (p.competitor_urls ?? []).map(c => {
          const match = convertedById.get(c.id)
          return match
            ? { ...c, last_price: match.last_price, last_price_currency: match.last_price_currency }
            : c
        }),
      }
    }))
  }

  const moveProduct = (fromId: string, toId: string) => {
    if (fromId === toId) return
    setProducts(prev => {
      const fromIndex = prev.findIndex(p => p.id === fromId)
      const toIndex = prev.findIndex(p => p.id === toId)
      if (fromIndex < 0 || toIndex < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }



  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar store={store} user={user} plan={plan} productCount={products.length} planLimit={limits.products} />

      <main className="flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8 min-w-0 overflow-x-hidden">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-5 sm:mb-7">
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Checks run {limits.checkFrequency} · {products.length} products · {totalCompetitors} URLs tracked
            </p>
          </div>
          <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap">
            <VatCountrySelector countryCode={vatCountryCode} onChange={handleVatCountryChange} />
            {vatRate > 0 && (
              <button
                type="button"
                onClick={() => { const n = !showVat; setShowVat(n); window.localStorage.setItem('pricingspy:showVat', String(n)) }}
                className={`flex items-center justify-center gap-2 border rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${showVat ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
              >
                VAT {showVat ? 'on' : 'off'}
              </button>
            )}
            <button
              onClick={() => setShowAddProduct(true)}
              disabled={products.length >= limits.products && limits.products !== Infinity}
              className="bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap w-full sm:w-auto"
            >
              + Add Product
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 mb-4 lg:mb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-gray-400 font-medium mb-1">Market position summary</div>
              <div className="text-xl sm:text-2xl font-extrabold text-gray-900">{marketSummary.leader}</div>
              <div className="text-xs text-gray-400 mt-1">Across all tracked products with competitor pricing</div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-[11px] text-emerald-700 font-semibold">Cheapest</div>
              <div className="text-lg font-extrabold text-emerald-800">{marketSummary.cheapest}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-700 font-semibold">Competitive</div>
              <div className="text-lg font-extrabold text-amber-800">{marketSummary.competitive}</div>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <div className="text-[11px] text-rose-700 font-semibold">Overpriced</div>
              <div className="text-lg font-extrabold text-rose-800">{marketSummary.overpriced}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-[11px] text-gray-600 font-semibold">No data</div>
              <div className="text-lg font-extrabold text-gray-700">{marketSummary.no_data}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5 lg:mb-7">
          {[
            { label: 'Products Tracked', value: products.length, sub: `${totalCompetitors} competitor URLs` },
            { label: 'Changes Today', value: changedToday, sub: 'price changes', highlight: changedToday > 0 },
            { label: 'Alerts Sent', value: alerts.length, sub: 'recent alerts', wide: true },
          ].map(stat => (
            <div key={stat.label} className={`bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 ${"wide" in stat && stat.wide ? "col-span-2 lg:col-span-1" : ""}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-gray-400 font-medium mb-1.5">{stat.label}</div>
                  <div className={`text-2xl sm:text-3xl font-extrabold ${'highlight' in stat && stat.highlight ? 'text-red-500' : 'text-gray-900'}`}>{stat.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{stat.sub}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {alerts.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <h2 className="font-bold text-sm mb-4">Recent Alerts</h2>
            <div className="space-y-0">
              {alerts.slice(0, 5).map((alert: any) => <AlertBadge key={alert.id} alert={alert} />)}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
          <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-0.5 w-full sm:w-auto">
            <button
              onClick={() => setViewMode('products')}
              className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors ${viewMode === 'products' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Products
            </button>
            <button
              onClick={() => setViewMode('competitors')}
              className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors ${viewMode === 'competitors' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              By Competitor
            </button>
          </div>
          <input
            type="text"
            placeholder={viewMode === 'products' ? 'Search products...' : 'Search competitors...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full sm:flex-1 sm:max-w-xs border border-gray-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-black transition-colors bg-white"
          />
          {viewMode === 'products' && (
            <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-0.5 w-full sm:w-auto">
              <button
                onClick={() => {
                  setProductLayout('list')
                  window.localStorage.setItem('pricingspy:productLayout', 'list')
                }}
                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors ${productLayout === 'list' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                List view
              </button>
              <button
                onClick={() => {
                  setProductLayout('grid')
                  window.localStorage.setItem('pricingspy:productLayout', 'grid')
                }}
                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors ${productLayout === 'grid' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                Grid view
              </button>
            </div>
          )}
          <span className="hidden sm:inline text-xs text-gray-400 sm:ml-auto">
            {viewMode === 'products' ? `${filteredProducts.length} products` : `${competitorGroups.length} competitors`}
          </span>
        </div>

        {viewMode === 'products' && (
          <div>
            {products.length === 0 ? (
              <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
                <div className="text-4xl mb-3">📦</div>
                <h3 className="font-bold text-base mb-1">No products yet</h3>
                <p className="text-sm text-gray-500 mb-5">Add your first product and start tracking competitor prices.</p>
                <button onClick={() => setShowAddProduct(true)} className="bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
                  Add your first product
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500">
                No products match &quot;{searchQuery}&quot;
              </div>
            ) : (
              <div className={productLayout === 'grid' ? 'grid grid-cols-1 xl:grid-cols-2 gap-3' : 'space-y-3'}>
                {filteredProducts.map(product => (
                  <div
                    key={product.id}
                    draggable
                    onDragStart={() => setDraggingProductId(product.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggingProductId) moveProduct(draggingProductId, product.id)
                      setDraggingProductId(null)
                    }}
                    onDragEnd={() => setDraggingProductId(null)}
                  >
                    <ProductCard
                      product={product}
                      marketPosition={productMarketPosition[product.id] ?? 'no_data'}
                      isExpanded={!!expandedProducts[product.id]}
                      onToggle={() => setExpandedProducts(prev => ({ ...prev, [product.id]: !prev[product.id] }))}
                      onEditProduct={() => setEditingProduct(product)}
                      onAddCompetitor={() => setAddCompetitorFor(product.id)}
                      onEditCompetitor={(competitor) => setEditingCompetitor({ productId: product.id, competitor })}
                      onRefreshCompetitor={triggerBackgroundFetch}
                      onToggleCompetitorAlert={handleToggleCompetitorAlert}
                      onCurrencyUpdated={handleProductCurrencyUpdated}
                      competitorLimit={limits.competitors}
                      showVat={showVat}
                      vatRate={vatRate}
                      competitorVatIncluded={{}}
                      fetchingIds={fetchingIds}
                      pendingPrices={pendingPrices}
                      onPendingVatIncludedChange={(competitorId, includesVat) => {
                        setPendingPrices(prev => {
                          const current = prev[competitorId]
                          if (!current) return prev
                          return { ...prev, [competitorId]: { ...current, includesVat } }
                        })
                      }}
                      onPendingMetricChange={(competitorId, metric) => {
                        setPendingPrices(prev => {
                          const current = prev[competitorId]
                          if (!current) return prev
                          return { ...prev, [competitorId]: { ...current, selectedMetric: metric } }
                        })
                      }}
                      onPendingCurrencyChange={(competitorId, currency) => {
                        const normalizedCurrency = normalizeCurrencyCode(currency)
                        setPendingPrices(prev => {
                          const current = prev[competitorId]
                          if (!current) return prev
                          return { ...prev, [competitorId]: { ...current, currency: normalizedCurrency } }
                        })
                      }}
                      onPendingDecimalShift={handlePendingDecimalShift}
                      onConfirmPrice={handleConfirmPrice}
                      onRejectPrice={handleRejectPrice}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === 'competitors' && (
          <div className="space-y-3">
            {competitorGroups.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500">
                No competitors added yet. Add some from the Products view.
              </div>
            ) : (
              competitorGroups
                .filter(g => !searchQuery || g.domain.includes(searchQuery.toLowerCase()))
                .map(group => {
                  const isOpen = expandedDomains.has(group.domain)
                  const anyChanged = group.entries.some(e =>
                    e.comp.last_changed_at && new Date(e.comp.last_changed_at) > new Date(Date.now() - 86400000)
                  )
                  const pricedEntries = group.entries.filter(e => e.comp.last_price !== null)

                  return (
                    <div key={group.domain} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => setExpandedDomains(prev => {
                          const next = new Set(prev)
                          if (next.has(group.domain)) next.delete(group.domain)
                          else next.add(group.domain)
                          return next
                        })}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${group.domain}&sz=32`}
                            alt=""
                            className="w-5 h-5"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{group.domain}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {group.entries.length} product{group.entries.length !== 1 ? 's' : ''} tracked
                            {pricedEntries.length > 0 && (
                              <span className="ml-1">
                                · prices: {pricedEntries.map(e => formatMoney(
                                  applyVat(e.comp.last_price!, showVat ? vatRate : 0),
                                  normalizeCurrencyCode(e.comp.last_price_currency ?? 'SEK')
                                )).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {anyChanged && <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">Changed!</span>}
                          <span className="text-gray-300 text-sm">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-100 px-5 pb-4 pt-3 space-y-2">
                          {group.entries.map(({ comp, product }) => {
                            const priceWithVat = comp.last_price !== null ? applyVat(comp.last_price, showVat ? vatRate : 0) : null
                            const productVatIncluded = product.vat_included ?? false
                            const productPrice = product.our_price !== null
                              ? (showVat
                                ? (productVatIncluded ? product.our_price : applyVat(product.our_price, vatRate))
                                : (productVatIncluded ? removeVat(product.our_price, vatRate) : product.our_price))
                              : null
                            const cheaper = priceWithVat !== null && productPrice !== null && priceWithVat < productPrice
                            const currency = normalizeCurrencyCode(comp.last_price_currency ?? product.currency_code ?? 'USD')
                            const stockStatus = comp.last_stock_status ?? 'unknown'
                            const stockLabel = stockStatus === 'in_stock' ? 'In stock' : stockStatus === 'out_of_stock' ? 'Out of stock' : 'Stock unknown'
                            const stockClass = stockStatus === 'in_stock'
                              ? 'text-emerald-700 bg-emerald-100 border-emerald-200'
                              : stockStatus === 'out_of_stock'
                                ? 'text-rose-700 bg-rose-100 border-rose-200'
                                : 'text-gray-600 bg-gray-100 border-gray-200'

                            return (
                              <div key={comp.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-gray-500 mb-0.5 truncate">{product.title}</div>
                                  <a href={comp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block max-w-sm">
                                    {comp.label || comp.url}
                                  </a>
                                </div>
                                <button
                                  onClick={() => setEditingCompetitor({ productId: product.id, competitor: comp })}
                                  className="text-gray-400 hover:text-black transition-colors text-sm shrink-0"
                                >
                                  ✏️
                                </button>
                                {priceWithVat !== null ? (
                                  <div className="text-right shrink-0">
                                    <div className={`text-base font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                                      {formatMoney(priceWithVat, currency)}
                                    </div>
                                    <div className={`text-[10px] font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                                      {cheaper ? 'CHEAPER' : 'HIGHER'}
                                    </div>
                                    <div className="mt-1">
                                      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${stockClass}`}>
                                        {stockLabel}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-right shrink-0">
                                    <span className="text-xs text-gray-400 block">No price yet</span>
                                    <span className={`mt-1 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${stockClass}`}>
                                      {stockLabel}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
            )}
          </div>
        )}

        {limits.products !== Infinity && products.length >= limits.products && (
          <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <p className="text-sm text-purple-700 font-medium">You have reached your {plan} plan limit of {limits.products} products.</p>
            <Link href="/dashboard/upgrade" className="inline-block bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">Upgrade Plan</Link>
          </div>
        )}
      </main>

      {addCompetitorFor && (
        <AddCompetitorModal
          productId={addCompetitorFor}
          productCurrency={products.find(p => p.id === addCompetitorFor)?.currency_code ?? 'USD'}
          onClose={() => setAddCompetitorFor(null)}
          onAdded={(comp) => handleCompetitorAdded(addCompetitorFor, comp)}
          onUpdated={(comp) => handleCompetitorUpdated(addCompetitorFor, comp)}
        />
      )}
      {editingCompetitor && (
        <AddCompetitorModal
          mode="edit"
          competitor={editingCompetitor.competitor}
          productId={editingCompetitor.productId}
          productCurrency={products.find(p => p.id === editingCompetitor.productId)?.currency_code ?? 'USD'}
          onClose={() => setEditingCompetitor(null)}
          onAdded={() => {}}
          onUpdated={(comp) => handleCompetitorUpdated(editingCompetitor.productId, comp)}
          onDeleted={(competitorId) => handleCompetitorDeleted(editingCompetitor.productId, competitorId)}
        />
      )}
      {showAddProduct && (
        <AddProductModal
          storeId={store?.id ?? ''}
          plan={plan}
          onClose={() => setShowAddProduct(false)}
          onAdded={handleProductAdded}
        />
      )}
      {editingProduct && (
        <AddProductModal
          mode="edit"
          plan={plan}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onAdded={() => {}}
          onUpdated={handleProductUpdated}
          onDeleted={handleProductDeleted}
        />
      )}
    </div>
  )
}
