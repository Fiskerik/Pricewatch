import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

const SHOPIFY_API_VERSION = '2026-01'
const SHOPIFY_PLANS = {
  pro: { name: 'Pricingspy Pro', price: 15.00, trialDays: 0 },
  business: { name: 'Pricingspy Business', price: 39.00, trialDays: 0 },
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json()
  if (!isShopifyPlan(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

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
    console.log('[shopify billing checkout] failed to load store', { userId: user.id, error: storeError.message })
    return NextResponse.json({ error: 'Could not load your connected Shopify store.' }, { status: 500 })
  }

  if (!store?.shop_domain || !store?.access_token) {
    return NextResponse.json({ error: 'Connect a Shopify store before upgrading.' }, { status: 400 })
  }

  const selectedPlan = SHOPIFY_PLANS[plan]
  const returnUrl = `${getAppUrl(req)}/api/shopify/billing/callback?plan=${encodeURIComponent(plan)}`

  const res = await fetch(
    `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/recurring_application_charges.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': store.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recurring_application_charge: {
          name: selectedPlan.name,
          price: selectedPlan.price,
          return_url: returnUrl,
          trial_days: selectedPlan.trialDays,
          test: process.env.NODE_ENV !== 'production',
        },
      }),
    }
  )

  const data = await res.json().catch(() => ({}))
  const charge = data.recurring_application_charge

  if (!res.ok || !charge?.confirmation_url) {
    console.log('[shopify billing checkout] failed to create charge', {
      shopDomain: store.shop_domain,
      plan,
      status: res.status,
      errors: data?.errors,
    })
    return NextResponse.json({ error: 'Failed to create Shopify charge. Please try again from your Shopify-connected account.' }, { status: 500 })
  }

  return NextResponse.json({ url: charge.confirmation_url })
}
