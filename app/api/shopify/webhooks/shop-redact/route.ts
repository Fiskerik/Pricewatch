import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyShopifyWebhook } from '../_shared/verify'

export async function POST(req: NextRequest) {
  const { valid, shopDomain } = await verifyShopifyWebhook(req)

  if (!valid) {
    console.warn('[shopify/webhooks/shop-redact] invalid signature', { shopDomain })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!shopDomain) {
    return NextResponse.json({ error: 'Missing x-shopify-shop-domain header' }, { status: 400 })
  }

  const { data: store, error: storeError } = await supabaseAdmin()
    .from('stores')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single()

  if (storeError || !store) {
    console.warn('[shopify/webhooks/shop-redact] store not found', { shopDomain, error: storeError?.message })
    return NextResponse.json({ ok: true })
  }

  const { data: products, error: productsError } = await supabaseAdmin()
    .from('products')
    .select('id')
    .eq('store_id', store.id)

  if (productsError) {
    console.error('[shopify/webhooks/shop-redact] failed loading products', { shopDomain, error: productsError.message })
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }

  const productIds = (products ?? []).map((p: { id: string }) => p.id)

  if (productIds.length > 0) {
    await supabaseAdmin().from('competitor_urls').delete().in('product_id', productIds)
    await supabaseAdmin().from('products').delete().in('id', productIds)
  }

  await supabaseAdmin().from('stores').delete().eq('id', store.id)

  console.log('[shopify/webhooks/shop-redact] redaction completed', { shopDomain, storeId: store.id })
  return NextResponse.json({ ok: true })
}
