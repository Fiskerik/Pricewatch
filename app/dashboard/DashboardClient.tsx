'use client'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { Store, Product, CompetitorUrl, PLAN_LIMITS } from '@/types'
import Sidebar from '@/components/Sidebar'
import ProductCard from '@/components/ProductCard'
import AddCompetitorModal from '@/components/AddCompetitorModal'
import AddProductModal from '@/components/AddProductModal'
import AlertBadge from '@/components/AlertBadge'

interface PendingPrice {
  price: number
  currency: string
}

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
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showVat, setShowVat] = useState(true)

  // Background fetch tracking
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set())
  const [pendingPrices, setPendingPrices] = useState<Map<string, PendingPrice>>(new Map())

  useEffect(() => {
    const stored = window.localStorage.getItem('pricewatch:showVat')
    if (stored === 'false') setShowVat(false)
  }, [])

  const handleVatToggle = () => {
    setShowVat(prev => {
      const next = !prev
      window.localStorage.setItem('pricewatch:showVat', String(next))
      return next
    })
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

  // Background price fetch — called after a competitor is added
  const triggerBackgroundFetch = (competitorId: string) => {
    setFetchingIds(prev => new Set([...prev, competitorId]))

    fetch('/api/competitors/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId }),
    })
      .then(async res => {
        if (!res.ok) return
        const data = await res.json()
        if (data.competitor?.last_price !== null && data.competitor?.last_price !== undefined) {
          // Price found — show confirmation UI
          setPendingPrices(prev => {
            const next = new Map(prev)
            next.set(competitorId, {
              price: data.competitor.last_price,
              currency: data.competitor.last_price_currency ?? 'USD',
            })
            return next
          })
          // Also update the competitor in products list with the fetched data
          setProducts(prev => prev.map(p => ({
            ...p,
            competitor_urls: (p.competitor_urls ?? []).map(c =>
              c.id === competitorId ? { ...c, ...data.competitor } : c
            ),
          })))
        }
      })
      .catch(() => {})
      .finally(() => {
        setFetchingIds(prev => {
          const next = new Set(prev)
          next.delete(competitorId)
          return next
        })
      })
  }

  const handleConfirmPrice = (competitorId: string) => {
    // Price is already saved in DB by the fetch endpoint — just dismiss the banner
    setPendingPrices(prev => {
      const next = new Map(prev)
      next.delete(competitorId)
      return next
    })
  }

  const handleRejectPrice = async (competitorId: string, productId: string) => {
    // User rejects the auto-fetched price — clear it in DB
    setPendingPrices(prev => {
      const next = new Map(prev)
      next.delete(competitorId)
      return next
    })
    // Optimistically clear the price in UI
    setProducts(prev => prev.map(p => ({
      ...p,
      competitor_urls: (p.competitor_urls ?? []).map(c =>
        c.id === competitorId ? { ...c, last_price: null, last_checked_at: null } : c
      ),
    })))
    // Clear in DB via update endpoint
    await fetch('/api/competitors/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId, url: products.flatMap(p => p.competitor_urls ?? []).find(c => c.id === competitorId)?.url ?? '', updatedPrice: null }),
    }).catch(() => {})
  }

  const handleProductAdded = (product: Product) => {
    setProducts(prev => [product, ...prev])
    setShowAddProduct(false)
  }

  const handleCompetitorAdded = (productId: string, competitor: CompetitorUrl) => {
    // Add to product list immediately
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return { ...p, competitor_urls: [...(p.competitor_urls ?? []), competitor] }
    }))
    setAddCompetitorFor(null)
    // Auto-expand the product so user sees the loading state
    setExpandedProduct(productId)
    // Trigger background price fetch
    triggerBackgroundFetch(competitor.id)
  }

  const handleCompetitorUpdated = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return {
        ...p,
        competitor_urls: (p.competitor_urls ?? []).map(c => c.id === competitor.id ? competitor : c),
      }
    }))
  }

  const handleCompetitorDeleted = (productId: string, competitorId: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return {
        ...p,
        competitor_urls: (p.competitor_urls ?? []).filter(c => c.id !== competitorId),
      }
    }))
    setEditingCompetitor(null)
    setPendingPrices(prev => { const n = new Map(prev); n.delete(competitorId); return n })
    setFetchingIds(prev => { const n = new Set(prev); n.delete(competitorId); return n })
  }

  const handleProductCurrencyUpdated = (productId: string, currencyCode: string) => {
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, currency_code: currencyCode } : p))
  }

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar store={store} user={user} plan={plan} productCount={products.length} planLimit={limits.products} />

      <main className="flex-1 p-8 overflow-y-auto max-h-screen">
        {/* Header */}
        <div className="flex justify-between items-start mb-7">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Checks run {limits.checkFrequency} · {products.length} products · {totalCompetitors} URLs tracked
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 font-semibold">
              <span>VAT on prices</span>
              <button
                type="button"
                onClick={handleVatToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showVat ? 'bg-black' : 'bg-gray-300'}`}
                aria-pressed={showVat}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${showVat ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>
            <button
              onClick={() => setShowAddProduct(true)}
              disabled={products.length >= limits.products && limits.products !== Infinity}
              className="bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add Product
            </button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-3 gap-4 mb-7">
          {[
            { label: 'Products Tracked', value: products.length, sub: `${totalCompetitors} competitor URLs`, icon: '📦' },
            { label: 'Changes Today', value: changedToday, sub: 'price changes', icon: '📊', highlight: changedToday > 0 },
            { label: 'Alerts Sent', value: alerts.length, sub: 'recent alerts', icon: '🔔' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-gray-400 font-medium mb-1.5">{stat.label}</div>
                  <div className={`text-3xl font-extrabold ${stat.highlight ? 'text-red-500' : 'text-gray-900'}`}>{stat.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{stat.sub}</div>
                </div>
                <span className="text-2xl">{stat.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Alerts */}
        {alerts.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
            <h2 className="font-bold text-sm mb-4">Recent Alerts</h2>
            <div className="space-y-0">
              {alerts.slice(0, 5).map((alert: any) => (
                <AlertBadge key={alert.id} alert={alert} />
              ))}
            </div>
          </div>
        )}

        {/* Products */}
        <h2 className="font-bold text-sm mb-3">Your Products</h2>

        {products.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="text-4xl mb-3">📦</div>
            <h3 className="font-bold text-base mb-1">No products yet</h3>
            <p className="text-sm text-gray-500 mb-5">Add your first product and start tracking competitor prices.</p>
            <button onClick={() => setShowAddProduct(true)} className="bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
              Add your first product
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {products.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                isExpanded={expandedProduct === product.id}
                onToggle={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                onAddCompetitor={() => setAddCompetitorFor(product.id)}
                onEditCompetitor={(competitor) => setEditingCompetitor({ productId: product.id, competitor })}
                onCurrencyUpdated={handleProductCurrencyUpdated}
                competitorLimit={limits.competitors}
                showVat={showVat}
                fetchingIds={fetchingIds}
                pendingPrices={pendingPrices}
                onConfirmPrice={handleConfirmPrice}
                onRejectPrice={(competitorId) => handleRejectPrice(competitorId, product.id)}
              />
            ))}
          </div>
        )}

        {limits.products !== Infinity && products.length >= limits.products && (
          <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center justify-between">
            <p className="text-sm text-purple-700 font-medium">You've reached your {plan} plan limit of {limits.products} products.</p>
            <button className="bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">
              Upgrade Plan
            </button>
          </div>
        )}
      </main>

      {/* Modals */}
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
          onClose={() => setShowAddProduct(false)}
          onAdded={handleProductAdded}
        />
      )}
    </div>
  )
}
