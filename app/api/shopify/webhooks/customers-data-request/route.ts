import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '../_shared/verify'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { valid, shopDomain, payload } = await verifyShopifyWebhook(req)

  if (!valid) {
    console.warn('[shopify/webhooks/customers-data-request] invalid signature', { shopDomain })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const customerId = payload?.customer?.id ?? payload?.customer?.admin_graphql_api_id
  const customerEmail = payload?.customer?.email
  const ordersRequested = payload?.orders_requested ?? []

  console.log('[shopify/webhooks/customers-data-request] received', {
    shopDomain,
    customerId,
    customerEmail,
    ordersRequested,
  })

  // Find the store
  const admin = supabaseAdmin()
  const { data: store } = await admin
    .from('stores')
    .select('id, user_id')
    .eq('shop_domain', shopDomain)
    .single()

  if (!store) {
    console.warn('[shopify/webhooks/customers-data-request] store not found', { shopDomain })
    return NextResponse.json({ ok: true }) // Still return 200 to Shopify
  }

  // Gather all data we have about this customer
  // Since we don't store customer data directly, we return an empty response
  // but log the request for compliance records
  const customerData = {
    shop_domain: shopDomain,
    customer_id: customerId,
    customer_email: customerEmail,
    data_stored: 'none', // We don't store customer-specific data
    note: 'Pricingspy tracks product prices only, not customer data',
  }

  console.log('[shopify/webhooks/customers-data-request] responding with customer data', customerData)

  // In production, you might want to email this to the merchant or store it for GDPR compliance
  return NextResponse.json({
    ok: true,
    customer_data: customerData,
  })
}
