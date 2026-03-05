import { NextRequest, NextResponse } from 'next/server'
import { getShopifyClient } from '@/lib/shopify'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const shop = url.searchParams.get('shop')
  if (!shop) {
    return NextResponse.json({ error: 'shop param required' }, { status: 400 })
  }

  // Initiate Shopify OAuth
  const authRoute = await getShopifyClient().auth.begin({
    shop,
    callbackPath: '/api/shopify/callback',
    isOnline: false,
    rawRequest: req,
    rawResponse: new Response(),
  })

  return NextResponse.redirect(authRoute)
}
