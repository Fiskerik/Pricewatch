import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getPlanUsageStatus } from '@/lib/planLimits'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    storeId, title, ourPrice, currencyCode, vatIncluded,
    shopifyProductId, shopifyVariantId, handle, imageUrl,
    mapFloorPrice, mapEnabled, autoPriceEnabled, autoPriceUndercutType, autoPriceUndercutValue,
  } = await req.json()

  if (!storeId || !title) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify this store belongs to the user
  const { data: store } = await supabase
    .from('stores')
    .select('id, plan')
    .eq('id', storeId)
    .eq('user_id', user.id)
    .single()

  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const { data: existingProducts, error: productsError } = await supabase
    .from('products')
    .select('id, competitor_urls(id)')
    .eq('store_id', storeId)

  if (productsError) {
    console.log('[products/add] failed loading existing products for plan validation', { storeId, userId: user.id, error: productsError.message })
    return NextResponse.json({ error: 'Failed to validate your plan limits.' }, { status: 500 })
  }

  const usage = getPlanUsageStatus(store.plan, (existingProducts ?? []) as any)
  if (usage.isPaused) {
    return NextResponse.json({
      error: 'Your current plan is below your saved usage. All tracking is paused until you delete enough products or competitors to get back within your tier limits.',
    }, { status: 409 })
  }

  if (usage.productLimit !== Infinity && usage.productCount >= usage.productLimit) {
    return NextResponse.json({ error: `Your ${usage.plan} plan allows up to ${usage.productLimit} products.` }, { status: 409 })
  }

  const canUseAutoPrice = store.plan === 'pro' || store.plan === 'business'

  const payload = {
    store_id: storeId,
    title,
    our_price: ourPrice ?? null,
    currency_code: currencyCode ?? 'USD',
    vat_included: typeof vatIncluded === 'boolean' ? vatIncluded : false,
    shopify_product_id: shopifyProductId ?? null,
    shopify_variant_id: shopifyVariantId ?? null,
    handle: handle ?? null,
    image_url: imageUrl ?? null,
    map_floor_price: typeof mapFloorPrice === 'number' && mapFloorPrice > 0 ? mapFloorPrice : null,
    map_enabled: typeof mapEnabled === 'boolean' ? mapEnabled : false,
    auto_price_enabled: canUseAutoPrice && typeof autoPriceEnabled === 'boolean' ? autoPriceEnabled : false,
    auto_price_undercut_type: canUseAutoPrice && autoPriceEnabled && (autoPriceUndercutType === 'percent' || autoPriceUndercutType === 'fixed') ? autoPriceUndercutType : null,
    auto_price_undercut_value: canUseAutoPrice && autoPriceEnabled && typeof autoPriceUndercutValue === 'number' && Number.isFinite(autoPriceUndercutValue)
      ? autoPriceUndercutValue
      : null,
  }

  let { data: product, error } = await supabase
    .from('products')
    .insert(payload)
    .select()
    .single()

  if (error?.message?.includes("'vat_included'")) {
    console.log('[products/add] vat_included column missing, retrying without it')
    const { vat_included: _v, ...payloadWithoutVat } = payload
    const retry = await supabase.from('products').insert(payloadWithoutVat).select().single()
    product = retry.data
    error = retry.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product })
}
