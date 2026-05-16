'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ConnectShopifyContent() {
  const [shop, setShop] = useState('')
  const [loading, setLoading] = useState(false)
  
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  
  let errorMessage: string | null = null
  if (errorParam) {
    const decoded = decodeURIComponent(errorParam)
    if (decoded.includes('already connected to email')) {
      errorMessage = decoded // e.g. "Shopify already connected to email john@example.com"
    } else if (decoded === 'shopify') {
      errorMessage = 'Something went wrong with Shopify. Please try again.'
    } else {
      errorMessage = decoded
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shop) return

    setLoading(true)

    let cleanShop = shop
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .trim()

    if (!cleanShop.includes('.')) {
      cleanShop = `${cleanShop}.myshopify.com`
    }

    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(cleanShop)}`
  }

  return (
    <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
      <h1 className="text-xl font-bold mb-4">Connect Shopify Store</h1>
      
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Shop URL
          </label>
          <input
            type="text"
            placeholder="my-store.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md disabled:opacity-50"
        >
          {loading ? 'Connecting...' : 'Connect Store'}
        </button>
      </form>
    </div>
  )
}

export default function ConnectShopify() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto mt-12 p-6 text-center">Loading...</div>}>
      <ConnectShopifyContent />
    </Suspense>
  )
}
