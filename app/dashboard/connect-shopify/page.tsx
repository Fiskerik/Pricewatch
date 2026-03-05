'use client'
import { useState } from 'react'
import Link from 'next/link'

export default function ConnectShopifyPage() {
  const [shop, setShop] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault()
    if (!shop.trim()) return
    setError(null)
    setLoading(true)

    // Normalize: strip https://, trailing slashes, etc.
    let domain = shop.trim().toLowerCase()
    domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')

    // Append .myshopify.com if not already present
    if (!domain.includes('.myshopify.com')) {
      domain = `${domain}.myshopify.com`
    }

    // Basic validation
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
      setError('Please enter a valid Shopify store domain, e.g. my-store or my-store.myshopify.com')
      setLoading(false)
      return
    }

    window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(domain)}`
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="w-full max-w-md">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors mb-8 block">
          ← Back to Dashboard
        </Link>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-xl">🛍️</div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight">Connect Shopify Store</h1>
              <p className="text-xs text-gray-500 mt-0.5">Sync your products automatically</p>
            </div>
          </div>

          {/* Benefits */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
            {[
              'All your products synced instantly',
              'Prices kept up to date automatically',
              'No manual product entry needed',
            ].map(b => (
              <div key={b} className="flex items-center gap-2 text-sm text-gray-600">
                <span className="text-green-500 font-bold">✓</span> {b}
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
                Store domain *
              </label>
              <input
                type="text"
                required
                value={shop}
                onChange={e => { setShop(e.target.value); setError(null) }}
                placeholder="my-store or my-store.myshopify.com"
                className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Found in your Shopify admin URL: <span className="font-medium text-gray-600">my-store</span>.myshopify.com
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !shop.trim()}
              className="w-full bg-black text-white font-bold py-2.5 rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Connecting...' : 'Connect Store →'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-4">
            We only request <span className="font-medium">read_products</span> access. We never modify your store.
          </p>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          Prefer to add products manually?{' '}
          <Link href="/dashboard" className="text-black font-semibold hover:underline">
            Go to Dashboard
          </Link>
        </p>
      </div>
    </div>
  )
}