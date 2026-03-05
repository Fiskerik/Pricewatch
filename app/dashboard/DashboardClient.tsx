'use client'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { Store, Product, CompetitorUrl, PLAN_LIMITS } from '@/types'
import Sidebar from '@/components/Sidebar'
import ProductCard from '@/components/ProductCard'
import AddCompetitorModal from '@/components/AddCompetitorModal'
import AddProductModal from '@/components/AddProductModal'
import AlertBadge from '@/components/AlertBadge'

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

  useEffect(() => {
    const storedPreference = window.localStorage.getItem('pricewatch:showVat')
    if (storedPreference === 'false') {
      setShowVat(false)
    }
  }, [])

  const handleVatToggle = () => {
    setShowVat(prev => {
      const nextValue = !prev
      window.localStorage.setItem('pricewatch:showVat', String(nextValue))
      return nextValue
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

  const handleProductAdded = (product: Product) => {
    setProducts(prev => [product, ...prev])
    setShowAddProduct(false)
  }

  const handleCompetitorAdded = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return { ...p, competitor_urls: [...(p.competitor_urls ?? []), competitor] }
    }))
    setAddCompetitorFor(null)
  }

  const handleCompetitorUpdated = (productId: string, competitor: CompetitorUrl) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return {
        ...p,
        competitor_urls: (p.competitor_urls ?? []).map(existing =>
          existing.id === competitor.id ? competitor : existing
        ),
      }
    }))
  }

  const handleCompetitorDeleted = (productId: string, competitorId: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      return {
        ...p,
        competitor_urls: (p.competitor_urls ?? []).filter(existing => existing.id !== competitorId),
      }
    }))
    setEditingCompetitor(null)
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
                aria-label="Toggle VAT on prices"
                title="Toggle VAT on prices"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${showVat ? 'translate-x-5' : 'translate-x-1'}`}
                />
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
              />
            ))}
          </div>
        )}

        {/* Plan limit warning */}
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
