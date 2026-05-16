'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import { Store, Plan } from '@/types'

interface Props {
  user: User
  store: Store | null
  plan: Plan
  productCount: number
  planLimit: number
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▤' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙' },
]

export default function Sidebar({ user, store, plan, productCount, planLimit }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClientComponentClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    console.log('Signing out from sidebar')
    await supabase.auth.signOut({ scope: 'global' })
    router.replace('/login')
    router.refresh()
    window.location.replace('/login')
  }

  const usagePct = planLimit === Infinity ? 0 : (productCount / planLimit) * 100

  // Inner Upgrade Button Component
  const UpgradeButton = ({ 
    plan: upgradePlan, 
    label, 
    primary = false 
  }: { 
    plan: 'pro' | 'business'
    label: string
    primary?: boolean 
  }) => {
    const [loading, setLoading] = useState(false)

    const handleUpgrade = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/shopify/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: upgradePlan }),
        })

        const data = await res.json()

        if (!res.ok) {
          if (data.error?.toLowerCase().includes('connect a shopify store')) {
            window.location.href = '/dashboard/connect-shopify'
            return
          }
          alert(data.error || 'Something went wrong')
          return
        }

        // Go directly to Shopify approval page
        window.location.href = data.url
      } catch (err) {
        console.error(err)
        alert('Failed to start upgrade. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    return (
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className={`block w-full text-center text-xs font-bold py-2 rounded-lg transition-colors ${
          primary
            ? 'bg-purple-600 text-white hover:bg-purple-700'
            : 'bg-white text-purple-700 border border-purple-300 hover:bg-purple-100'
        }`}
      >
        {loading ? 'Redirecting...' : label}
      </button>
    )
  }

  const SidebarInner = (
    <div className="flex flex-col h-full">
      <div className="px-5 pb-5 border-b border-gray-100">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <Image src="/logo.png" alt="Pricingspy logo" width={28} height={28} className="rounded-md" />
          <span className="font-bold text-sm">Pricingspy</span>
        </Link>
      </div>

      <div className="px-5 py-3 border-b border-gray-100">
        {store?.shop_domain ? (
          <>
            <div className="text-[11px] text-gray-400 font-medium mb-0.5 uppercase tracking-wide">Connected store</div>
            <div className="text-[11px] font-semibold leading-snug text-gray-700 break-all">{store.shop_domain}</div>
          </>
        ) : (
          <Link href="/dashboard/connect-shopify" className="text-xs font-semibold text-purple-600 hover:underline" onClick={() => setMobileOpen(false)}>
            + Connect Shopify store
          </Link>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === item.href
                ? 'bg-gray-100 font-semibold text-gray-900'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="px-3 mb-3">
        <div className="bg-purple-50 rounded-xl p-3.5">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">{plan} Plan</span>
          </div>

          {planLimit !== Infinity && (
            <>
              <div className="text-xs text-gray-500 mb-2">{productCount} / {planLimit} products</div>
              <div className="bg-purple-100 rounded-full h-1.5 mb-3">
                <div className="bg-purple-500 rounded-full h-1.5 transition-all" style={{ width: `${Math.min(usagePct, 100)}%` }} />
              </div>
            </>
          )}

          {plan === 'free' && (
            <div className="space-y-2">
              <div className="text-[11px] text-purple-700 font-semibold">Unlock more tracking with Pro or Business.</div>
              <div className="flex flex-col gap-1.5">
                <UpgradeButton plan="pro" label="Upgrade to Pro" primary />
                <UpgradeButton plan="business" label="Upgrade to Business" />
              </div>
            </div>
          )}

          {plan === 'pro' && (
            <div className="space-y-2">
              <div className="text-[11px] text-purple-700 font-semibold">Need unlimited limits? Go Business.</div>
              <UpgradeButton plan="business" label="Upgrade to Business →" primary />
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-3 border-t border-gray-100">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-start gap-2 min-w-0">
            <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
              {user.email?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">User</div>
              <div className="text-[11px] leading-snug text-gray-700 break-all">{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="lg:hidden w-full bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo.png" alt="Pricingspy logo" width={24} height={24} className="rounded-md" />
          <span className="font-bold text-sm">Pricingspy</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(prev => !prev)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {mobileOpen ? '✕ Close' : '☰ Menu'}
        </button>
      </div>

      {mobileOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      )}

      <aside className={`
        lg:hidden fixed top-0 left-0 z-50 h-full w-80 max-w-[88vw]
        bg-white border-r border-gray-100 py-5 shadow-2xl
        transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-[105%]'}
      `}>
        {SidebarInner}
      </aside>

      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-gray-100 py-5 sticky top-0 h-screen">
        {SidebarInner}
      </aside>
    </>
  )
}
