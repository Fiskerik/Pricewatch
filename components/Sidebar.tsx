'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import { Store, Plan, PLAN_LIMITS } from '@/types'

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
    await supabase.auth.signOut()
    router.push('/')
  }

  const usagePct = planLimit === Infinity ? 0 : (productCount / planLimit) * 100

  const SidebarInner = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pb-5 border-b border-gray-100">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <Image src="/logo.png" alt="PriceWatch logo" width={28} height={28} className="rounded-md" />
          <span className="font-bold text-sm">PriceWatch</span>
        </Link>
      </div>

      {/* Store badge */}
      <div className="px-5 py-3 border-b border-gray-100">
        {store?.shop_domain ? (
          <>
            <div className="text-xs text-gray-400 font-medium mb-0.5">Connected store</div>
            <div className="text-xs font-semibold text-gray-700 truncate">{store.shop_domain}</div>
          </>
        ) : (
          <Link href="/dashboard/connect-shopify" className="text-xs font-semibold text-purple-600 hover:underline" onClick={() => setMobileOpen(false)}>
            + Connect Shopify store
          </Link>
        )}
      </div>

      {/* Nav */}
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

      {/* Plan usage */}
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
            <Link href="/dashboard/upgrade" className="block w-full text-center bg-purple-600 text-white text-xs font-bold py-1.5 rounded-lg hover:bg-purple-700 transition-colors" onClick={() => setMobileOpen(false)}>
              Upgrade to Pro →
            </Link>
          )}
        </div>
      </div>

      {/* User */}
      <div className="px-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
            {user.email?.[0]?.toUpperCase()}
          </div>
          <span className="text-xs text-gray-600 truncate flex-1">{user.email}</span>
          <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600" title="Sign out">↪</button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* ── Mobile top bar ───────────────────────────────────── */}
      <div className="lg:hidden w-full bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="PriceWatch logo" width={24} height={24} className="rounded-md" />
          <span className="font-bold text-sm">PriceWatch</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(prev => !prev)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {mobileOpen ? '✕ Close' : '☰ Menu'}
        </button>
      </div>

      {/* ── Mobile drawer backdrop ───────────────────────────── */}
      {mobileOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      )}

      {/* ── Mobile drawer ────────────────────────────────────── */}
      <aside className={`
        lg:hidden fixed top-0 left-0 z-50 h-full w-72 max-w-[85vw]
        bg-white border-r border-gray-100 py-5 shadow-2xl
        transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-[105%]'}
      `}>
        {SidebarInner}
      </aside>

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 bg-white border-r border-gray-100 py-5 sticky top-0 h-screen">
        {SidebarInner}
      </aside>
    </>
  )
}
