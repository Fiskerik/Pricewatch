'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: ['5 products', '2 competitors per product', 'Daily price checks', 'Email alerts'],
    cta: null,
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$15',
    period: 'per month',
    features: ['25 products', '5 competitors per product', 'Daily price checks', 'Email alerts', 'Price history charts', 'Auto price adjust'],
    cta: 'Upgrade to Pro',
    highlight: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: '$39',
    period: 'per month',
    features: ['Unlimited products', 'Unlimited competitors', 'Hourly price checks', 'Email + Slack alerts', 'Price history charts', 'Auto price adjust', 'Priority support'],
    cta: 'Upgrade to Business',
    highlight: false,
  },
]

const FAQ = [
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Your subscription is managed in Shopify, and any cancellation or plan changes are handled from your Shopify admin.',
  },
  {
    q: 'What happens if I downgrade?',
    a: 'Your products and history are kept. If you exceed the free plan limit, new checks are paused until you remove some products.',
  },
  {
    q: 'Which payment methods are accepted?',
    a: 'Paid plans are approved through Shopify billing and charged using the payment method associated with your Shopify store.',
  },
  {
    q: 'Is there a free trial?',
    a: 'The Free plan is free forever, no card required. Paid plans are billed immediately — contact us within 24h for a refund.',
  },
]

function UpgradeContent() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const billingError = searchParams?.get('error')
    if (!billingError) return

    const errorMessages: Record<string, string> = {
      missing_params: 'Shopify did not return the billing details needed to complete your upgrade.',
      no_store: 'Connect a Shopify store before upgrading.',
      charge_declined: 'The Shopify charge was not accepted. Please try again or choose a different plan.',
      activation_failed: 'Shopify accepted the charge, but activation failed. Please try again.',
      plan_update_failed: 'Shopify accepted the charge, but we could not update your plan. Contact support so we can fix it.',
    }

    setError(errorMessages[billingError] ?? 'Shopify billing could not complete your upgrade. Please try again.')
  }, [searchParams])

  const handleUpgrade = async (planId: string) => {
    setLoading(planId)
    setError(null)
    try {
      const res = await fetch('/api/shopify/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'No connected Shopify store found. Please connect your store first.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="mb-10">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight mt-6 mb-2">Upgrade your plan</h1>
          <p className="text-gray-500 text-sm">Track more products. Check prices more often. No contracts — cancel anytime.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`rounded-2xl p-7 border-2 flex flex-col ${plan.highlight ? 'bg-black text-white border-black' : 'bg-white border-gray-200'}`}
            >
              {plan.highlight && (
                <div className="text-xs font-bold text-green-400 uppercase tracking-widest mb-3">Most popular</div>
              )}
              <div className="font-bold text-base mb-1">{plan.name}</div>
              <div className="text-4xl font-extrabold mb-1">{plan.price}</div>
              <div className={`text-sm mb-6 ${plan.highlight ? 'text-gray-400' : 'text-gray-400'}`}>{plan.period}</div>
              <ul className="flex-1 space-y-3 mb-8">
                {plan.features.map(f => (
                  <li key={f} className="text-sm flex items-center gap-2">
                    <span className={plan.highlight ? 'text-green-400' : 'text-green-500'}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {plan.id === 'free' ? (
                <div className="w-full text-center font-semibold py-3 rounded-xl text-sm bg-gray-100 text-gray-500">
                  Current plan
                </div>
              ) : (
                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={loading === plan.id}
                  className={`w-full font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${plan.highlight ? 'bg-white text-black hover:bg-gray-100' : 'bg-black text-white hover:bg-gray-800'}`}
                >
                  {loading === plan.id ? 'Redirecting...' : plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-7">
          <h2 className="font-bold text-base mb-5">Common questions</h2>
          <div className="space-y-5">
            {FAQ.map(item => (
              <div key={item.q} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                <div className="text-sm font-bold mb-1">{item.q}</div>
                <div className="text-sm text-gray-500">{item.a}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}


export default function UpgradePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <UpgradeContent />
    </Suspense>
  )
}
