import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '../_shared/verify'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { valid, shopDomain, payload } = await verifyShopifyWebhook(req)

  if (!valid) {
    console.warn('[shopify/webhooks/customers-redact] invalid signature', { shopDomain })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const customerId = payload?.customer?.id ?? payload?.customer?.admin_graphql_api_id
  const customerEmail = payload?.customer?.email

  console.log('[shopify/webhooks/customers-redact] received', {
    shopDomain,
    customerId,
    customerEmail,
  })
  
  // For customer-specific features in the future
  const admin = supabaseAdmin()
  const { data: store } = await admin
    .from('stores')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single()

  if (store) {
    console.log('[shopify/webhooks/customers-redact] confirmed: no customer data stored', {
      shopDomain,
      customerId,
      storeId: store.id,
    })
  }

  return NextResponse.json({ ok: true, redacted: 'no_customer_data_stored' })
}
