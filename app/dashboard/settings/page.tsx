'use client'
import { useState, useEffect, Suspense } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface Store {
  id: string
  shop_domain: string | null
  store_name: string | null
  is_primary: boolean
  created_at: string
  plan: string | null
  stripe_customer_id?: string | null
}

interface MockCompetitor {
  id: string
  label: string | null
  url: string
  last_price: number | null
  last_price_currency: string | null
  products: {
    id: string
    title: string | null
    store_id: string
  } | {
    id: string
    title: string | null
    store_id: string
  }[] | null
}

function SettingsContent() {
  const supabase = createClientComponentClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const [mockCompetitors, setMockCompetitors] = useState<MockCompetitor[]>([])
  const [selectedCompetitorId, setSelectedCompetitorId] = useState('')
  const [mockPriceInput, setMockPriceInput] = useState('')
  const [mockEmailPriceInput, setMockEmailPriceInput] = useState('')
  const [mockLoading, setMockLoading] = useState(false)
  const [mockMessage, setMockMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: allStores } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })

      const safeStores = allStores || []
      setStores(safeStores)

      const storeIds = safeStores.map(store => store.id)
      if (storeIds.length > 0) {
        const { data: competitors, error: competitorError } = await supabase
          .from('competitor_urls')
          .select('id, label, url, last_price, last_price_currency, products!inner(id, title, store_id)')
          .in('products.store_id', storeIds)
          .order('created_at', { ascending: false })

        if (competitorError) {
          setMockMessage({ type: 'error', text: 'Could not load competitors for testing.' })
        } else {
          const list = ((competitors || []) as MockCompetitor[])
          setMockCompetitors(list)
          console.log('[settings/mock] competitors loaded', {
            count: list.length,
            sample: list.slice(0, 3).map((item) => ({
              id: item.id,
              label: item.label,
              hasArrayProducts: Array.isArray(item.products),
              productTitle: Array.isArray(item.products) ? item.products[0]?.title : item.products?.title,
            })),
          })
          if (list.length > 0) setSelectedCompetitorId(list[0].id)
        }
      }

      setLoading(false)
    }
    load()

    if (searchParams?.get('connected') === 'true') {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 5000)
    }
  }, [searchParams, supabase, router])

  const handleDisconnectStore = async (storeId: string) => {
    setSaving(true)
    try {
      await supabase
        .from('stores')
        .update({ shop_domain: null, access_token: null, store_name: null })
        .eq('id', storeId)
        .eq('user_id', user.id)

      const { data: allStores } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })

      setStores(allStores || [])
    } finally {
      setSaving(false)
    }
  }

  const handleSetPrimary = async (storeId: string) => {
    setSaving(true)
    try {
      await supabase
        .from('stores')
        .update({ is_primary: true })
        .eq('id', storeId)
        .eq('user_id', user.id)

      const { data: allStores } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })

      setStores(allStores || [])
    } finally {
      setSaving(false)
    }
  }

  const handleQueueMockPrice = async () => {
    const parsedPrice = Number(mockPriceInput)
    if (!selectedCompetitorId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setMockMessage({ type: 'error', text: 'Select a competitor and enter a valid price.' })
      return
    }

    setMockLoading(true)
    setMockMessage(null)

    try {
      const res = await fetch('/api/mock/queue-price-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId: selectedCompetitorId, mockPrice: parsedPrice }),
      })

      const data = await res.json()
      if (!res.ok) {
        setMockMessage({ type: 'error', text: data?.error ?? 'Failed to queue mock price change.' })
        return
      }

      setMockMessage({ type: 'success', text: 'Mock price queued. Next cron run will use this value once.' })
    } catch {
      setMockMessage({ type: 'error', text: 'Could not queue mock price. Try again.' })
    } finally {
      setMockLoading(false)
    }
  }

  const handleSendMockEmail = async () => {
    const parsedPrice = Number(mockEmailPriceInput)
    if (!selectedCompetitorId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setMockMessage({ type: 'error', text: 'Select a competitor and enter a valid test email price.' })
      return
    }

    setMockLoading(true)
    setMockMessage(null)

    try {
      const res = await fetch('/api/mock/send-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId: selectedCompetitorId, newPrice: parsedPrice }),
      })

      const data = await res.json()
      if (!res.ok) {
        setMockMessage({ type: 'error', text: data?.error ?? 'Failed to send test email.' })
        return
      }

      setMockMessage({ type: 'success', text: 'Test email sent to your registered email.' })
    } catch {
      setMockMessage({ type: 'error', text: 'Could not send test email. Try again.' })
    } finally {
      setMockLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const primaryStore = stores.find(s => s.is_primary)
  const connectedStores = stores.filter(s => s.shop_domain)
  const selectedCompetitor = mockCompetitors.find(c => c.id === selectedCompetitorId) ?? null

  const getMockCompetitorProductTitle = (competitor: MockCompetitor) => {
    if (Array.isArray(competitor.products)) {
      return competitor.products[0]?.title?.trim() || null
    }

    if (competitor.products && typeof competitor.products === 'object') {
      return competitor.products.title?.trim() || null
    }

    return null
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight">Settings</h1>
        </div>

        {showSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium rounded-xl px-4 py-3 mb-6">
            ✓ Store connected successfully
          </div>
        )}

        {searchParams?.get('error') === 'shopify' && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-6">
            Failed to connect store. Please try again.
          </div>
        )}

        <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <h2 className="font-bold text-base mb-4">Account</h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Email</div>
              <div className="text-sm font-medium text-gray-900">{user?.email}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Plan</div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900 capitalize">{primaryStore?.plan ?? 'Free'}</span>
                {primaryStore?.plan === 'free' && (
                  <Link
                    href="/dashboard/upgrade"
                    className="text-xs font-bold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg hover:bg-purple-100 transition-colors"
                  >
                    Upgrade →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-base">Shopify Stores</h2>
            <Link
              href="/dashboard/connect-shopify"
              className="text-sm font-semibold text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors"
            >
              + Add Store
            </Link>
          </div>

          {connectedStores.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">No Shopify stores connected yet.</p>
              <Link
                href="/dashboard/connect-shopify"
                className="inline-block bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Connect Your First Store
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {connectedStores.map(store => {
                const needsReauth = store.shopify_scopes && !store.shopify_scopes.includes('write_products')
                
                return (
                  <div key={store.id} className="border border-gray-200 rounded-xl p-4">
                    {needsReauth && (
                      <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 font-medium">
                        ⚠ Reconnect required to enable auto-pricing.{' '}
                        
                          href={`/api/shopify/auth?shop=${store.shop_domain}`}
                          className="underline font-bold"
                        >
                          Reconnect now →
                        </a>
                      </div>
                    )}
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-sm font-semibold text-gray-900">{store.store_name || store.shop_domain}</div>
                        {store.is_primary && (
                          <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded">PRIMARY</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{store.shop_domain}</div>
                    </div>
                    <div className="flex gap-2">
                      {!store.is_primary && (
                        <button onClick={() => handleSetPrimary(store.id)} disabled={saving} className="text-xs font-semibold text-purple-600 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50">
                          Set Primary
                        </button>
                      )}
                      <button onClick={() => handleDisconnectStore(store.id)} disabled={saving} className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
                        {saving ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <h2 className="font-bold text-base mb-1">Temporary Mock Testing</h2>
          <p className="text-xs text-gray-500 mb-4">
            Queue a one-time mock price for the selected competitor. The next cron run will use this mocked price and trigger your normal alert flow if it differs from current saved price.
          </p>

          {mockCompetitors.length === 0 ? (
            <p className="text-sm text-gray-500">No competitors found for your stores yet.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Competitor</label>
                <select
                  value={selectedCompetitorId}
                  onChange={(event) => setSelectedCompetitorId(event.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {mockCompetitors.map(comp => (
                    <option key={comp.id} value={comp.id}>
                      {getMockCompetitorProductTitle(comp) ?? comp.label ?? comp.url} · {comp.label ?? comp.url}
                    </option>
                  ))}
                </select>
                {selectedCompetitor && (
                  <div className="mt-2 text-xs text-gray-500">
                    Current saved price: {selectedCompetitor.last_price ?? 'N/A'} {selectedCompetitor.last_price_currency ?? ''}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Mock price for next cron run</label>
                  <input
                    value={mockPriceInput}
                    onChange={(event) => setMockPriceInput(event.target.value)}
                    placeholder="e.g. 79.99"
                    inputMode="decimal"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Test email price (send now)</label>
                  <input
                    value={mockEmailPriceInput}
                    onChange={(event) => setMockEmailPriceInput(event.target.value)}
                    placeholder="e.g. 79.99"
                    inputMode="decimal"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleQueueMockPrice}
                  disabled={mockLoading}
                  className="text-sm font-semibold text-white bg-black px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {mockLoading ? 'Working...' : 'Queue mock price for cron'}
                </button>
                <button
                  onClick={handleSendMockEmail}
                  disabled={mockLoading}
                  className="text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-4 py-2 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  {mockLoading ? 'Working...' : 'Send test email now'}
                </button>
              </div>

              {mockMessage && (
                <div className={`text-sm rounded-lg px-3 py-2 ${mockMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  {mockMessage.text}
                </div>
              )}
            </div>
          )}
        </section>

        {primaryStore?.stripe_customer_id && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <h2 className="font-bold text-base mb-4">Billing</h2>
            <button
              onClick={async () => {
                const res = await fetch('/api/stripe/portal', { method: 'POST' })
                const data = await res.json()
                if (data.url) window.location.href = data.url
              }}
              className="text-sm font-semibold text-gray-900 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Open billing portal →
            </button>
          </section>
        )}

        <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
          Sign out
        </button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading settings...</div>
      </div>
    }>
      <SettingsContent />
    </Suspense>
  )
}
