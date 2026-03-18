import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyShopifyWebhook } from '../_shared/verify'

async function handleCustomersDataRequest(shopDomain: string | null, payload: any) {
  const customerId = payload?.customer?.id ?? payload?.customer?.admin_graphql_api_id
  const customerEmail = payload?.customer?.email
  const ordersRequested = payload?.orders_requested ?? []

  console.log('[shopify/webhooks/customers-data-request] received', {
    shopDomain,
    customerId,
    customerEmail,
    ordersRequested,
  })

  const admin = supabaseAdmin()
  const { data: store } = await admin
    .from('stores')
    .select('id, user_id')
    .eq('shop_domain', shopDomain)
    .single()

  if (!store) {
    console.warn('[shopify/webhooks/customers-data-request] store not found', { shopDomain })
    return NextResponse.json({ ok: true })
  }

  const customerData = {
    shop_domain: shopDomain,
    customer_id: customerId,
    customer_email: customerEmail,
    data_stored: 'none',
    note: 'Pricingspy tracks product prices only, not customer data',
  }

  console.log('[shopify/webhooks/customers-data-request] responding with customer data', customerData)

  return NextResponse.json({
    ok: true,
    customer_data: customerData,
  })
}

async function handleCustomersRedact(shopDomain: string | null, payload: any) {
  const customerId = payload?.customer?.id ?? payload?.customer?.admin_graphql_api_id
  const customerEmail = payload?.customer?.email

  console.log('[shopify/webhooks/customers-redact] received', {
    shopDomain,
    customerId,
    customerEmail,
  })

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

async function handleShopRedact(shopDomain: string | null) {
  if (!shopDomain) {
    return NextResponse.json({ error: 'Missing x-shopify-shop-domain header' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single()

  if (storeError || !store) {
    console.warn('[shopify/webhooks/shop-redact] store not found', { shopDomain, error: storeError?.message })
    return NextResponse.json({ ok: true })
  }

  const { data: products, error: productsError } = await admin
    .from('products')
    .select('id')
    .eq('store_id', store.id)

  if (productsError) {
    console.error('[shopify/webhooks/shop-redact] failed loading products', { shopDomain, error: productsError.message })
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }

  const productIds = (products ?? []).map((product: { id: string }) => product.id)

  if (productIds.length > 0) {
    await admin.from('competitor_urls').delete().in('product_id', productIds)
    await admin.from('products').delete().in('id', productIds)
  }

  await admin.from('stores').delete().eq('id', store.id)

  console.log('[shopify/webhooks/shop-redact] redaction completed', { shopDomain, storeId: store.id })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const { valid, topic, shopDomain, payload } = await verifyShopifyWebhook(req)

  if (!valid) {
    console.warn('[shopify/webhooks/compliance] invalid signature', { topic, shopDomain })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  switch (topic) {
    case 'customers/data_request':
      return handleCustomersDataRequest(shopDomain, payload)
    case 'customers/redact':
      return handleCustomersRedact(shopDomain, payload)
    case 'shop/redact':
      return handleShopRedact(shopDomain)
    default:
      console.warn('[shopify/webhooks/compliance] unsupported topic', { topic, shopDomain })
      return NextResponse.json({ error: 'Unsupported webhook topic' }, { status: 400 })
  }
}
