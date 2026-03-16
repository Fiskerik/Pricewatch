import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const shop = url.searchParams.get('shop')
  
  if (!shop) {
    return NextResponse.json({ error: 'shop param required' }, { status: 400 })
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
