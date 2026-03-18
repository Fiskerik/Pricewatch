import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

const SHOPIFY_PLANS = {
  pro: { name: 'Pricingspy Pro', price: 15.00, trialDays: 0 },
  business: { name: 'Pricingspy Business', price: 39.00, trialDays: 0 },
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json()
  if (!SHOPIFY_PLANS[plan as keyof typeof SHOPIFY_PLANS]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const { data: store } = await supabase
    .from('stores')
    .select('shop_domain, access_token')
    .eq('user_id', user.id)
    .not('shop_domain', 'is', null)
    .single()

  if (!store?.shop_domain || !store?.access_token) {
    return NextResponse.json({ error: 'No connected Shopify store' }, { status: 400 })
  }

  const selectedPlan = SHOPIFY_PLANS[plan as keyof typeof SHOPIFY_PLANS]
  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/shopify/billing/callback?plan=${plan}`

  const res = await fetch(
    `https://${store.shop_domain}/admin/api/2024-01/recurring_application_charges.json`,
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

  const data = await res.json()
  const charge = data.recurring_application_charge

  if (!charge?.confirmation_url) {
    return NextResponse.json({ error: 'Failed to create Shopify charge' }, { status: 500 })
  }

  return NextResponse.json({ url: charge.confirmation_url })
}
