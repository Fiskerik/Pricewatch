"use client"

import { useState } from 'react"

export default function UpgradePage() {
  const [loading, setLoading] = useState<string | null>(null)

  const handleUpgrade = async (planName: string, price: number) => {
    setLoading(planName)
    try {
      const res = await fetch('/api/shopify/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: planName,
          price: price,
          isTest: process.env.NODE_ENV !== 'production'
        }),
      })

      const data = await res.json()
      if (data.url) {
        // Break out of framing contexts safely to allow Shopify external billing approval pages to load
        if (typeof window !== 'undefined') {
          if (window.top) {
            window.top.location.href = data.url
          } else {
            window.location.href = data.url
          }
        }
      } else {
        alert(data.error || 'Something went wrong')
      }
    } catch (err) {
      alert('Failed to initiate checkout link.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Upgrade Subscription</h1>
      <p className="text-gray-600 mb-8">Choose a plan to increase your store tracking capabilities.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pro Plan Box */}
        <div className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-2">Pro</h2>
            <p className="text-gray-500 text-sm mb-4">Track up to 3 connected stores.</p>
            <div className="text-3xl font-bold mb-6">$19<span className="text-sm font-normal text-gray-500">/mo</span></div>
          </div>
          <button
            onClick={() => handleUpgrade('Pro', 19.00)}
            disabled={loading !== null}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition disabled:opacity-50"
          >
            {loading === 'Pro' ? 'Processing...' : 'Upgrade to Pro'}
          </button>
        </div>

        {/* Business Plan Box */}
        <div className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-2">Business</h2>
            <p className="text-gray-500 text-sm mb-4">Track up to 10 connected stores.</p>
            <div className="text-3xl font-bold mb-6">$49<span className="text-sm font-normal text-gray-500">/mo</span></div>
          </div>
          <button
            onClick={() => handleUpgrade('Business', 49.00)}
            disabled={loading !== null}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition disabled:opacity-50"
          >
            {loading === 'Business' ? 'Processing...' : 'Upgrade to Business'}
          </button>
        </div>
      </div>
    </div>
  )
}
