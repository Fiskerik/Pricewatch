'use client'
import { useEffect, useState, useMemo } from 'react'
import { User } from '@supabase/supabase-js'
import { Store, Product, CompetitorUrl, PLAN_LIMITS } from '@/types'
import Sidebar from '@/components/Sidebar'
import ProductCard from '@/components/ProductCard'
import AddCompetitorModal from '@/components/AddCompetitorModal'
import AddProductModal from '@/components/AddProductModal'
import AlertBadge from '@/components/AlertBadge'
import VatCountrySelector, { detectCountryCode, VAT_COUNTRIES } from '@/components/VatCountrySelector'
import { formatMoney, normalizeCurrencyCode } from '@/lib/currency'
import { applyVat } from '@/lib/vat'

interface PendingPrice { price: number; currency: string }
type ViewMode = 'products' | 'competitors'

interface Props {
  user: User
  store: Store | null
  initialProducts: Product[]
  initialAlerts: any[]
}

export default function DashboardClient({ user, store, initialProducts, initialAlerts }: Props) {
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [alerts] = useState(initialAlerts)
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [addCompetitorFor, setAddCompetitorFor] = useState<string | null>(null)
  const [editingCompetitor, setEditingCompetitor] = useState<{ productId: string; competitor: CompetitorUrl } | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showAddProduct, setShowAddProduct] = useState(false)

  // VAT state lifted up — avoids flash-of-no-VAT in ProductCard
  const [vatCountryCode, setVatCountryCode] = useState<string>('SE')
  const [vatRate, setVatRate] = useState<number>(25)
  const [showVat, setShowVat] = useState(true)

  // View + filter
  const [viewMode, setViewMode] = useState<ViewMode>('products')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  // Background fetch
  const [fetchingIds, setFetchingIds] = useState<Record<string, boolean>>({})
  const [pendingPrices, setPendingPrices] = useState<Record<string, PendingPrice>>({})

  useEffect(() => {
    const storedCountry = window.localStorage.getItem('pricewatch:vatCountry')
    const code = storedCountry ?? detectCountryCode()
    const country = VAT_COUNTRIES.find(c => c.code === code) ?? VAT_COUNTRIES.find(c => c.code === 'SE')!
    setVatCountryCode(country.code)
    setVatRate(country.rate)

    const storedVat = window.localStorage.getItem('pricewatch:showVat')
    if (storedVat === 'false') setShowVat(false)
  }, [])

  const handleVatCountryChange = (code: string, rate: number) => {
    setVatCountryCode(code)
    setVatRate(rate)
    window.localStorage.setItem('pricewatch:vatCountry', code)
    const next = rate > 0
    setShowVat(next)
    window.localStorage.setItem('pricewatch:showVat', String(next))
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

  const triggerBackgroundFetch = (competitorId: string) => {
    setFetchingIds(prev => ({ ...prev, [competitorId]: true }))
    fetch('/api/competitors/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId }),
    })
      .then(async res => {
        if (!res.ok) return
        const data = await res.json()
        const comp = data.competitor
        if (comp?.last_price != null) {
          setPendingPrices(prev => ({
            ...prev,
            [competitorId]: { price: comp.last_price, currency: comp.last_price_currency ?? 'USD' },
          }))
          setProducts(prev => prev.map(p => ({
            ...p,
            competitor_urls: (p.competitor_urls ?? []).map(c => c.id === competitorId ? { ...c, ...comp } : c),
          })))
        }
      })
      .catch(() => {})
      .finally(() => { setFetchingIds(prev => { const n = { ...prev }; delete n[competitorId]; return n }) })
  }

  const handleConfirmPrice = async (id: string, includesVat: boolean) => {
    const pending = pendingPrices[id]
    const competitor = products.flatMap(p => p.competitor_urls ?? []).find(c => c.id === id)
    if (!pending || !competitor) {
      setPendingPrices(prev => { const n = { ...prev }; delete n[id]; return n })
      return
    }

    const adjustedPrice = includesVat ? pending.price : applyVat(pending.price, vatRate)
    console.log('[dashboard] confirming pending competitor price', {
      competitorId: id,
      fetchedPrice: pending.price,
      includesVat,
      adjustedPrice,
      vatRate,
      currency: pending.currency,
    })

    setProducts(prev => prev.map(p => ({
      ...p,
      competitor_urls: (p.competitor_urls ?? []).map(c =>
        c.id === id
          ? { ...c, last_price: adjustedPrice, last_price_currency: pending.currency, last_checked_at: new Date().toISOString() }
          : c,
      ),
    })))

    setPendingPrices(prev => { const n = { ...prev }; delete n[id]; return n })

    await fetch('/api/competitors/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        competitorId: id,
        url: competitor.url,
        label: competitor.label,
        updatedPrice: adjustedPrice,
        updatedCurrency: pending.currency,
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

  const handleProductAdded = (product: Product) => { setProducts(prev => [product, ...prev]); setShowAddProduct(false) }

  const handleCompetitorAdded = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : { ...p, competitor_urls: [...(p.competitor_urls ?? []), competitor] }
    ))
    setAddCompetitorFor(null)
    setExpandedProduct(productId)
    triggerBackgroundFetch(competitor.id)
  }

  const handleCompetitorUpdated = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : {
        ...p, competitor_urls: (p.competitor_urls ?? []).map(c => c.id === competitor.id ? competitor : c),
      }
    ))
  }

  const handleCompetitorDeleted = (productId: string, competitorId: string) => {
    setProducts(prev => prev.map(p =>
      p.id !== productId ? p : { ...p, competitor_urls: (p.competitor_urls ?? []).filter(c => c.id !== competitorId) }
    ))
    setEditingCompetitor(null)
    setPendingPrices(prev => { const n = { ...prev }; delete n[competitorId]; return n })
    setFetchingIds(prev => { const n = { ...prev }; delete n[competitorId]; return n })
  }

  const handleProductCurrencyUpdated = (
    productId: string,
    currencyCode: string,
    converted?: {
      product?: { our_price: number | null }
      competitors?: { id: string; last_price: number | null; last_price_currency: string | null }[]
    },
  ) => {
    const convertedCompetitorsById = Object.fromEntries((converted?.competitors ?? []).map(c => [c.id, c]))
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return {
        ...p,
        currency_code: currencyCode,
        our_price: converted?.product?.our_price ?? p.our_price,
        competitor_urls: (p.competitor_urls ?? []).map(c => ({
          ...c,
          last_price: convertedCompetitorsById[c.id]?.last_price ?? c.last_price,
          last_price_currency: convertedCompetitorsById[c.id]?.last_price_currency ?? c.last_price_currency,
        })),
      }
    }))
  }

  const handleProductUpdated = (updatedProduct: Product) => {
    setProducts(prev => prev.map(p => p.id === updatedProduct.id ? { ...p, ...updatedProduct } : p))
    setEditingProduct(null)
  }

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 lg:items-stretch overflow-x-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar store={store} user={user} plan={plan} productCount={products.length} planLimit={limits.products} />

      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto lg:max-h-screen">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:justify-between lg:items-start mb-7">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Checks run {limits.checkFrequency} · {products.length} products · {totalCompetitors} URLs tracked
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <VatCountrySelector countryCode={vatCountryCode} onChange={handleVatCountryChange} />
            {vatRate > 0 && (
              <button
                type="button"
                onClick={() => { const n = !showVat; setShowVat(n); window.localStorage.setItem('pricewatch:showVat', String(n)) }}
                className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${showVat ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
              >
                VAT {showVat ? 'on' : 'off'}
              </button>
            )}
            <button
              onClick={() => setShowAddProduct(true)}
              disabled={products.length >= limits.products && limits.products !== Infinity}
              className="bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add Product
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-7">
          {[
            { label: 'Products Tracked', value: products.length, sub: `${totalCompetitors} competitor URLs`, icon: '📦' },
            { label: 'Changes Today', value: changedToday, sub: 'price changes', icon: '📊', highlight: changedToday > 0 },
            { label: 'Alerts Sent', value: alerts.length, sub: 'recent alerts', icon: '🔔' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-gray-400 font-medium mb-1.5">{stat.label}</div>
                  <div className={`text-3xl font-extrabold ${'highlight' in stat && stat.highlight ? 'text-red-500' : 'text-gray-900'}`}>{stat.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{stat.sub}</div>
                </div>
                <span className="text-2xl">{stat.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <h2 className="font-bold text-sm mb-4">Recent Alerts</h2>
            <div className="space-y-0">
              {alerts.slice(0, 5).map((alert: any) => <AlertBadge key={alert.id} alert={alert} />)}
            </div>
          </div>
        )}

        {/* View toggle + search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-0.5 w-full sm:w-auto">
            <button
              onClick={() => setViewMode('products')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${viewMode === 'products' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Products
            </button>
            <button
              onClick={() => setViewMode('competitors')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${viewMode === 'competitors' ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-900'}`}
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
          <span className="text-xs text-gray-400 sm:ml-auto">
            {viewMode === 'products' ? `${filteredProducts.length} products` : `${competitorGroups.length} competitors`}
          </span>
        </div>

        {/* Products view */}
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
              <div className="space-y-3">
                {filteredProducts.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isExpanded={expandedProduct === product.id}
                    onToggle={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                    onEditProduct={(selectedProduct) => setEditingProduct(selectedProduct)}
                    onAddCompetitor={() => setAddCompetitorFor(product.id)}
                    onEditCompetitor={(competitor) => setEditingCompetitor({ productId: product.id, competitor })}
                    onCurrencyUpdated={handleProductCurrencyUpdated}
                    competitorLimit={limits.competitors}
                    showVat={showVat}
                    fetchingIds={fetchingIds}
                    pendingPrices={pendingPrices}
                    onConfirmPrice={handleConfirmPrice}
                    onRejectPrice={handleRejectPrice}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Competitor view */}
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
                  const isOpen = expandedDomain === group.domain
                  const anyChanged = group.entries.some(e =>
                    e.comp.last_changed_at && new Date(e.comp.last_changed_at) > new Date(Date.now() - 86400000)
                  )
                  const pricedEntries = group.entries.filter(e => e.comp.last_price !== null)

                  return (
                    <div key={group.domain} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => setExpandedDomain(isOpen ? null : group.domain)}
                        className="w-full flex items-start sm:items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 text-left hover:bg-gray-50 transition-colors"
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
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                          {anyChanged && <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">Changed!</span>}
                          <span className="text-gray-300 text-sm">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-100 px-4 sm:px-5 pb-4 pt-3 space-y-2">
                          {group.entries.map(({ comp, product }) => {
                            const priceWithVat = comp.last_price !== null ? applyVat(comp.last_price, showVat ? vatRate : 0) : null
                            const productPrice = product.our_price !== null ? applyVat(product.our_price, showVat ? vatRate : 0) : null
                            const cheaper = priceWithVat !== null && productPrice !== null && priceWithVat < productPrice
                            const currency = normalizeCurrencyCode(comp.last_price_currency ?? product.currency_code ?? 'USD')

                            return (
                              <div key={comp.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 sm:px-4 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-gray-500 mb-0.5 truncate">{product.title}</div>
                                  <a href={comp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block max-w-full sm:max-w-sm">
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
                                  <div className="text-right shrink-0 ml-auto">
                                    <div className={`text-base font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                                      {formatMoney(priceWithVat, currency)}
                                    </div>
                                    <div className={`text-[10px] font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                                      {cheaper ? 'CHEAPER' : 'HIGHER'}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 shrink-0">No price yet</span>
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
          <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:justify-between">
            <p className="text-sm text-purple-700 font-medium">You have reached your {plan} plan limit of {limits.products} products.</p>
            <button className="bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">Upgrade Plan</button>
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
      {editingProduct && (
        <AddProductModal
          mode="edit"
          product={editingProduct}
          storeId={store?.id ?? ''}
          onClose={() => setEditingProduct(null)}
          onAdded={() => {}}
          onUpdated={handleProductUpdated}
        />
      )}
      {showAddProduct && (
        <AddProductModal
          storeId={store?.id ?? ''}
          onClose={() => setShowAddProduct(false)}
          onAdded={handleProductAdded}
        />
      )}
    </div>
  )
}
