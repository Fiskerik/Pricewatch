import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STORE_LIMITS: Record<string, number> = {
  free: 1,
  pro: 3,
  business: 10,
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const shop = url.searchParams.get('shop')

  if (!shop) {
    return NextResponse.json({ error: 'shop param required' }, { status: 400 })
  }

  const { data: stores, error: storesError } = await supabaseAdmin()
    .from('stores')
    .select('plan, shop_domain, is_primary')
    .eq('user_id', user.id)

  if (storesError) {
    console.error('[Shopify Auth] failed to load stores for plan limit check', storesError.message)
    return NextResponse.redirect(new URL('/dashboard/settings?error=shopify', req.url))
  }

  const normalizedStores = stores || []
  const primaryStore = normalizedStores.find((store: any) => store.is_primary) ?? normalizedStores[0]
  const currentPlan = (primaryStore?.plan ?? 'free').toLowerCase()
  const storeLimit = STORE_LIMITS[currentPlan] ?? STORE_LIMITS.free
  const connectedStores = normalizedStores.filter((store: any) => store.shop_domain)
  const connectedStoresCount = connectedStores.length
  const normalizedShop = shop.toLowerCase()
  const existingConnectedStore = connectedStores.find((store: any) => String(store.shop_domain || '').toLowerCase() === normalizedShop)

  console.log('[Shopify Auth] store limit check', {
    userId: user.id,
    currentPlan,
    connectedStoresCount,
    storeLimit,
    requestedShop: shop,
    existingConnectedStore: Boolean(existingConnectedStore),
  })

  if (!existingConnectedStore && connectedStoresCount >= storeLimit) {
    return NextResponse.redirect(new URL(`/dashboard/settings?error=store_limit&plan=${currentPlan}&limit=${storeLimit}`, req.url))
  }

  if (existingConnectedStore) {
    return NextResponse.redirect(new URL(`/dashboard/settings?error=store_duplicate&shop=${encodeURIComponent(shop)}`, req.url))
  }

  // Build Shopify OAuth URL manually
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const apiKey = process.env.SHOPIFY_API_KEY!
  const scopes = 'read_products,write_products'
  const appOrigin = appUrl ? new URL(appUrl).origin : req.nextUrl.origin
  const redirectUri = `${appOrigin}/api/shopify/callback`
  
  // Generate random state for CSRF protection
  const state = Math.random().toString(36).substring(7)
  
  // Store state in cookie for verification in callback
  console.log('[Shopify Auth] appUrl:', appUrl)
  console.log('[Shopify Auth] appOrigin:', appOrigin)
  console.log('[Shopify Auth] redirectUri:', redirectUri)

  const response = NextResponse.redirect(
    `https://${shop}/admin/oauth/authorize?` +
    `client_id=${apiKey}&` +
    `scope=${scopes}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`
  )
  
  response.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
  })
  
  return response
}
