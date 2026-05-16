import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

const SHOPIFY_API_VERSION = '2025-07' // or 2026-01

const SHOPIFY_PLANS = {
  pro: { name: 'Pricingspy Pro', price: '15.00', trialDays: 0 },
  business: { name: 'Pricingspy Business', price: '39.00', trialDays: 0 },
} as const

type ShopifyPlan = keyof typeof SHOPIFY_PLANS

function isShopifyPlan(plan: unknown): plan is ShopifyPlan {
  return plan === 'pro' || plan === 'business'
}

function getAppUrl(req: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { plan } = await req.json()
  if (!isShopifyPlan(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // Fetch connected store
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('shop_domain, access_token')
    .eq('user_id', user.id)
    .not('shop_domain', 'is', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (storeError) {
    console.error('[shopify billing checkout] failed to load store', { 
      userId: user.id, 
      error: storeError.message 
    })
    return NextResponse.json({ 
      error: 'Could not load your connected Shopify store.' 
    }, { status: 500 })
  }

  if (!store?.shop_domain || !store?.access_token) {
    return NextResponse.json({ 
      error: 'Connect a Shopify store before upgrading.' 
    }, { status: 400 })
  }

  const selectedPlan = SHOPIFY_PLANS[plan]
  const returnUrl = `${getAppUrl(req)}/api/shopify/billing/callback?plan=${encodeURIComponent(plan)}`

  console.log('Creating subscription for shop:', store.shop_domain)
  console.log('Plan:', plan)

  try {
    const response = await fetch(
      `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': store.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            mutation appSubscriptionCreate(
              $name: String!,
              $returnUrl: URL!,
              $price: Decimal!
            ) {
              appSubscriptionCreate(
                name: $name
                returnUrl: $returnUrl
                test: ${process.env.NODE_ENV !== 'production'}
                lineItems: [{
                  plan: {
                    appRecurringPricingDetails: {
                      price: { amount: $price, interval: EVERY_30_DAYS }
                    }
                  }
                }]
              ) {
                userErrors {
                  field
                  message
                }
                confirmationUrl
                appSubscription {
                  id
                }
              }
            }
          `,
          variables: {
            name: selectedPlan.name,
            returnUrl: returnUrl,
            price: selectedPlan.price,
          },
        }),
      }
    )

    const result = await response.json()

    if (!response.ok || result.errors) {
      console.error('[Shopify Billing] GraphQL Error:', result)
      return NextResponse.json({ 
        error: result.errors?.[0]?.message || 'Failed to create subscription' 
      }, { status: 500 })
    }

    const subscriptionData = result.data.appSubscriptionCreate

    if (subscriptionData.userErrors?.length > 0) {
      console.error('[Shopify Billing] User Errors:', subscriptionData.userErrors)
      return NextResponse.json({ 
        error: subscriptionData.userErrors[0].message 
      }, { status: 400 })
    }

    if (!subscriptionData.confirmationUrl) {
      return NextResponse.json({ 
        error: 'Failed to get confirmation URL from Shopify' 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      url: subscriptionData.confirmationUrl 
    })

  } catch (error: any) {
    console.error('[Shopify Billing] Unexpected error:', error)
    return NextResponse.json({ 
      error: 'Failed to create Shopify charge. Please try again.' 
    }, { status: 500 })
  }
}
