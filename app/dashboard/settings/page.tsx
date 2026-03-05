'use client'
import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SettingsPage() {
  const supabase = createClientComponentClient()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [store, setStore] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: store } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id)
        .single()
      setStore(store)
      setLoading(false)
    }
    load()
  }, [])

  const handleDisconnectShopify = async () => {
    setSaving(true)
    await supabase
      .from('stores')
      .update({ shop_domain: null, access_token: null })
      .eq('user_id', user.id)
    setStore((s: any) => ({ ...s, shop_domain: null }))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
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
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight">Settings</h1>
        </div>

        {saved && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium rounded-xl px-4 py-3 mb-6">
            ✓ Changes saved
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
                <span className="text-sm font-medium text-gray-900 capitalize">{store?.plan ?? 'Free'}</span>
                {store?.plan === 'free' && (
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

        {/* Shopify */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <h2 className="font-bold text-base mb-4">Shopify Integration</h2>
          {store?.shop_domain ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Connected Store</div>
                <div className="text-sm font-medium text-gray-900">{store.shop_domain}</div>
              </div>
              <button
                onClick={handleDisconnectShopify}
                disabled={saving}
                className="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {saving ? 'Disconnecting...' : 'Disconnect store'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">No Shopify store connected yet.</p>
              <Link
                href="/dashboard/connect-shopify"
                className="inline-block bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Connect Shopify Store
              </Link>
            </div>
          )}
        </section>

        {/* Billing */}
        {store?.stripe_customer_id && (
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