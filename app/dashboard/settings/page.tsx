'use client'
import { useState, useEffect } from 'react'
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

export default function SettingsPage() {
  const supabase = createClientComponentClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      // Fetch all stores for this user
      const { data: allStores } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })

      setStores(allStores || [])
      setLoading(false)
    }
    load()

    // Show success message if just connected
    if (searchParams?.get('connected') === 'true') {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 5000)
    }
  }, [searchParams])

  const handleDisconnectStore = async (storeId: string) => {
    setSaving(true)
    try {
      await supabase
        .from('stores')
        .update({ shop_domain: null, access_token: null, store_name: null })
        .eq('id', storeId)
        .eq('user_id', user.id)

      // Refresh stores list
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

      // Refresh stores list
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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const primaryStore = stores.find(s => s.is_primary)
  const connectedStores = stores.filter(s => s.shop_domain)

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
        {/* Header */}
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

        {/* Account */}
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

        {/* Shopify Stores */}
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
              {connectedStores.map(store => (
                <div
                  key={store.id}
                  className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-sm font-semibold text-gray-900">
                          {store.store_name || store.shop_domain}
                        </div>
                        {store.is_primary && (
                          <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded">
                            PRIMARY
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{store.shop_domain}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        Connected {new Date(store.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!store.is_primary && (
                        <button
                          onClick={() => handleSetPrimary(store.id)}
                          disabled={saving}
                          className="text-xs font-semibold text-purple-600 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50"
                        >
                          Set Primary
                        </button>
                      )}
                      <button
                        onClick={() => handleDisconnectStore(store.id)}
                        disabled={saving}
                        className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-700">
              <strong>Pro tip:</strong> Connect multiple stores to track competitor prices across all your brands from one dashboard.
            </p>
          </div>
        </section>

        {/* Billing */}
        {primaryStore?.stripe_customer_id && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <h2 className="font-bold text-base mb-4">Billing</h2>
            <p className="text-sm text-gray-500 mb-4">Manage your subscription, invoices, and payment method.</p>
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

        {/* Danger zone */}
        <section className="bg-white rounded-2xl border border-red-100 p-6 mb-4">
          <h2 className="font-bold text-base text-red-600 mb-4">Danger Zone</h2>
          {!deleteConfirm ? (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors"
            >
              Delete account
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-600 font-medium">Are you sure? This cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="text-sm font-semibold border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut()
                    router.push('/')
                  }}
                  className="text-sm font-semibold bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Yes, delete my account
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
