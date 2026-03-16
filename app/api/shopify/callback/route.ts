import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

async function ensureGdprWebhookSubscriptions({ shop, accessToken, appOrigin }: { shop: string, accessToken: string, appOrigin: string }) {
  const callbackBase = `${appOrigin}/api/shopify/webhooks`
  const targets = [
    { topic: 'CUSTOMERS_REDACT', callback: `${callbackBase}/customers-redact` },
    { topic: 'SHOP_REDACT', callback: `${callbackBase}/shop-redact` },
    { topic: 'CUSTOMERS_DATA_REQUEST', callback: `${callbackBase}/customers-data-request` },
  ]

  for (const target of targets) {
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: $topic,
          webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
        ) {
          userErrors { field message }
        }
      }
    `

    const registerRes = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          topic: target.topic,
          callbackUrl: target.callback,
        },
      }),
    })

    const registerData = await registerRes.json()
    const userErrors = registerData?.data?.webhookSubscriptionCreate?.userErrors ?? []
    if (!registerRes.ok || userErrors.length > 0) {
      console.warn('[shopify/callback] GDPR webhook registration warning', {
        shop,
        topic: target.topic,
        userErrors,
      })
    }
  }
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const shop = url.searchParams.get('shop')
  const state = url.searchParams.get('state')
  const hmac = url.searchParams.get('hmac')

  // Verify state (CSRF protection)
  const cookieState = req.cookies.get('shopify_oauth_state')?.value
  if (state !== cookieState) {
    return NextResponse.redirect(new URL('/dashboard?error=invalid_state', req.url))
  }

  // Verify HMAC
  const params = new URLSearchParams(url.search)
  params.delete('hmac')
  const message = params.toString()
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex')

  if (hash !== hmac) {
    console.log('[shopify/callback] HMAC validation failed', { shop })
    return NextResponse.redirect(new URL('/dashboard?error=invalid_hmac', req.url))
  }

  try {
    // 1. Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    })

    const { access_token } = await tokenResponse.json()
    if (!access_token) throw new Error('No access token received')

    // 2. Fetch granted scopes from Shopify
    let grantedScopes = ''
    try {
      const accessInfoRes = await fetch(
        `https://${shop}/admin/oauth/access_scopes.json`,
        { headers: { 'X-Shopify-Access-Token': access_token } }
      )
      const accessInfo = await accessInfoRes.json()
      grantedScopes = (accessInfo?.access_scopes ?? [])
        .map((s: any) => s.handle)
        .join(',')
    } catch (scopeErr) {
      console.warn('[shopify/callback] failed to fetch scopes', String(scopeErr))
    }

    // 3. Check if store already connected
    const { data: existingStore } = await supabaseAdmin()
      .from('stores')
      .select('id')
      .eq('user_id', user.id)
      .eq('shop_domain', shop)
      .single()

    let store

    if (existingStore) {
      const { data: updatedStore, error } = await supabaseAdmin()
        .from('stores')
        .update({
          access_token,
          shopify_scopes: grantedScopes,
          store_name: shop?.replace('.myshopify.com', '') || 'Shopify Store',
        })
        .eq('id', existingStore.id)
        .select()
        .single()

      if (error) throw new Error('Failed to update store')
      store = updatedStore
    } else {
      const { data: userStores } = await supabaseAdmin()
        .from('stores')
        .select('id')
        .eq('user_id', user.id)

      const isFirstStore = !userStores || userStores.length === 0

      const { data: newStore, error } = await supabaseAdmin()
        .from('stores')
        .insert({
          user_id: user.id,
          shop_domain: shop,
          access_token,
          shopify_scopes: grantedScopes,
          store_name: shop?.replace('.myshopify.com', '') || 'Shopify Store',
          is_primary: isFirstStore,
        })
        .select()
        .single()

      if (error) throw new Error('Failed to create store')
      store = newStore
    }

    // 4. Register GDPR webhooks
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const appOrigin = appUrl ? new URL(appUrl).origin : req.nextUrl.origin
    await ensureGdprWebhookSubscriptions({ shop: String(shop), accessToken: access_token, appOrigin })

    // 5. Fetch and sync products
    const productsResponse = await fetch(
      `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images,variants`,
      {
        headers: {
          'X-Shopify-Access-Token': access_token,
          'Content-Type': 'application/json',
        },
      }
    )

    const { products } = await productsResponse.json()

    for (const product of products || []) {
      const mainVariant = product.variants?.[0]
      await supabaseAdmin()
        .from('products')
        .upsert({
          store_id: store.id,
          shopify_product_id: String(product.id),
          shopify_variant_id: String(mainVariant?.id ?? ''),
          title: product.title,
          handle: product.handle,
          image_url: product.images?.[0]?.src ?? null,
          our_price: mainVariant?.price ? parseFloat(mainVariant.price) : null,
          currency_code: 'USD',
        }, {
          onConflict: 'shopify_product_id,store_id',
        })
    }

    const response = NextResponse.redirect(new URL('/dashboard/settings?connected=true', req.url))
    response.cookies.delete('shopify_oauth_state')
    return response
  } catch (err) {
    console.error('Shopify callback error:', err)
    return NextResponse.redirect(new URL('/dashboard/settings?error=shopify', req.url))
  }
}
