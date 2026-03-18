import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const STORE_LIMITS: Record<string, number> = {
  free: 1,
  pro: 3,
  business: 10,
}

const resolveStoreLimit = (plan: string | null | undefined) => {
  const normalizedPlan = (plan || 'free').toLowerCase()
  return {
    plan: normalizedPlan,
    limit: STORE_LIMITS[normalizedPlan] ?? STORE_LIMITS.free,
  }
}


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
    let grantedScopes: string | null = null
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
      .select('id, shopify_scopes')
      .eq('user_id', user.id)
      .eq('shop_domain', shop)
      .single()

    const { data: userStores, error: userStoresError } = await supabaseAdmin()
      .from('stores')
      .select('id, plan, shop_domain, is_primary')
      .eq('user_id', user.id)

    if (userStoresError) {
      throw new Error(`Failed to fetch stores for limit validation: ${userStoresError.message}`)
    }

    const normalizedUserStores = userStores || []
    const primaryStoreForPlan = normalizedUserStores.find((store: any) => store.is_primary) ?? normalizedUserStores[0]
    const { plan, limit } = resolveStoreLimit(primaryStoreForPlan?.plan)
    const connectedStoresCount = normalizedUserStores.filter((store: any) => store.shop_domain).length
    const reusableDisconnectedStore = normalizedUserStores.find((store: any) => !store.shop_domain)

    console.log('[shopify/callback] validating store limit', {
      userId: user.id,
      plan,
      limit,
      connectedStoresCount,
      targetShop: shop,
      hasExistingStore: Boolean(existingStore),
      reusableDisconnectedStoreId: reusableDisconnectedStore?.id ?? null,
    })

    if (!existingStore && !reusableDisconnectedStore && connectedStoresCount >= limit) {
      return NextResponse.redirect(new URL(`/dashboard/settings?error=store_limit&plan=${plan}&limit=${limit}`, req.url))
    }

    let store

    if (existingStore || reusableDisconnectedStore) {
      const storeToUpdate = existingStore?.id ?? reusableDisconnectedStore?.id
      const { data: updatedStore, error: updateError } = await supabaseAdmin()
        .from('stores')
        .update({
          shop_domain: shop,
          access_token,
          shopify_scopes: grantedScopes && grantedScopes.length > 0
            ? grantedScopes
            : (existingStore?.shopify_scopes ?? 'read_products,write_products'),
          store_name: shop?.replace('.myshopify.com', '') || 'Shopify Store',
        })
        .eq('id', storeToUpdate)
        .select()
        .single()

      if (updateError) {
        console.error('[shopify/callback] failed to update existing or reusable store', {
          shop,
          storeId: storeToUpdate,
          message: updateError.message,
        })
        throw new Error('Failed to update store')
      }
      store = updatedStore
    } else {
      const isFirstStore = normalizedUserStores.length === 0

      const { data: newStore, error: insertError } = await supabaseAdmin()
        .from('stores')
        .insert({
          user_id: user.id,
          shop_domain: shop,
          access_token,
          shopify_scopes: grantedScopes && grantedScopes.length > 0 ? grantedScopes : 'read_products,write_products',
          store_name: shop?.replace('.myshopify.com', '') || 'Shopify Store',
          is_primary: isFirstStore,
          plan,
        })
        .select()
        .single()

      if (insertError) {
        console.error('[shopify/callback] failed to create store', {
          shop,
          userId: user.id,
          message: insertError.message,
        })
        throw new Error('Failed to create store')
      }
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
