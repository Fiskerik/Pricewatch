import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const chargeId = url.searchParams.get('charge_id')
  const plan = url.searchParams.get('plan')

  if (!chargeId || !plan) {
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=missing_params', req.url))
  }

  const { data: store } = await supabase
    .from('stores')
    .select('id, shop_domain, access_token')
    .eq('user_id', user.id)
    .not('shop_domain', 'is', null)
    .single()

  if (!store?.shop_domain || !store?.access_token) {
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=no_store', req.url))
  }

  // Verifiera att charge är accepterad
  const res = await fetch(
    `https://${store.shop_domain}/admin/api/2024-01/recurring_application_charges/${chargeId}.json`,
    { headers: { 'X-Shopify-Access-Token': store.access_token } }
  )

  const data = await res.json()
  const charge = data.recurring_application_charge

  if (charge?.status !== 'accepted') {
    return NextResponse.redirect(new URL('/dashboard/upgrade?error=charge_declined', req.url))
  }

  // Aktivera charge
  await fetch(
    `https://${store.shop_domain}/admin/api/2024-01/recurring_application_charges/${chargeId}/activate.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': store.access_token },
    }
  )

  // Uppdatera plan i databasen
  await supabaseAdmin()
    .from('stores')
    .update({
      plan,
      shopify_charge_id: chargeId,
    })
    .eq('id', store.id)

  return NextResponse.redirect(new URL('/dashboard?upgraded=true', req.url))
}
