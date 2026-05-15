import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SHOPIFY_API_VERSION = '2026-01'
const SHOPIFY_PLANS = ['pro', 'business'] as const
type ShopifyPlan = (typeof SHOPIFY_PLANS)[number]

function isShopifyPlan(plan: string | null): plan is ShopifyPlan {
  return plan === 'pro' || plan === 'business'
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const chargeId = url.searchParams.get('charge_id')
  const plan = url.searchParams.get('plan')

  if (!chargeId || !isShopifyPlan(plan)) {
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=missing_params', req.url))
  }

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id, shop_domain, access_token')
    .eq('user_id', user.id)
    .not('shop_domain', 'is', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (storeError) {
    console.log('[shopify billing callback] failed to load store', { userId: user.id, error: storeError.message })
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=no_store', req.url))
  }

  if (!store?.shop_domain || !store?.access_token) {
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=no_store', req.url))
  }

  const chargeRes = await fetch(
    `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/recurring_application_charges/${chargeId}.json`,
    { headers: { 'X-Shopify-Access-Token': store.access_token } }
  )

  const chargeData = await chargeRes.json().catch(() => ({}))
  const charge = chargeData.recurring_application_charge

  if (!chargeRes.ok || !charge || !['accepted', 'active'].includes(charge.status)) {
    console.log('[shopify billing callback] charge was not accepted', {
      shopDomain: store.shop_domain,
      chargeId,
      status: charge?.status,
      responseStatus: chargeRes.status,
      errors: chargeData?.errors,
    })
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=charge_declined', req.url))
  }

  if (charge.status === 'accepted') {
    const activateRes = await fetch(
      `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/recurring_application_charges/${chargeId}/activate.json`,
      {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': store.access_token },
      }
    )

    if (!activateRes.ok) {
      const activateData = await activateRes.json().catch(() => ({}))
      console.log('[shopify billing callback] failed to activate charge', {
        shopDomain: store.shop_domain,
        chargeId,
        status: activateRes.status,
        errors: activateData?.errors,
      })
      return NextResponse.redirect(new URL('/dashboard/upgrade?error=activation_failed', req.url))
    }
  }

  const { error: updateError } = await supabaseAdmin()
    .from('stores')
    .update({
      plan,
      shopify_charge_id: chargeId,
    })
    .eq('id', store.id)

  if (updateError) {
    console.log('[shopify billing callback] failed to update plan', { storeId: store.id, plan, error: updateError.message })
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=plan_update_failed', req.url))
  }

  return NextResponse.redirect(new URL('/dashboard?upgraded=true', req.url))
}
