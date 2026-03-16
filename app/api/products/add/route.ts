import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { storeId, title, ourPrice, currencyCode, vatIncluded, shopifyProductId, handle, imageUrl, mapFloorPrice, mapEnabled } = await req.json()
  if (!storeId || !title) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify this store belongs to the user
  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('user_id', user.id)
    .single()

  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const payload = {
    store_id: storeId,
    title,
    our_price: ourPrice ?? null,
    currency_code: currencyCode ?? 'USD',
    vat_included: typeof vatIncluded === 'boolean' ? vatIncluded : false,
    shopify_product_id: shopifyProductId ?? null,
    handle: handle ?? null,
    image_url: imageUrl ?? null,
    shopify_variant_id: shopifyVariantId ?? null,
  }

  let { data: product, error } = await supabase
    .from('products')
    .insert(payload)
    .select()
    .single()

  if (error?.message?.includes("'vat_included'")) {
    console.log('[products/add] vat_included column missing in products table, retrying without vat_included')
    const { vat_included: _ignoredVatIncluded, ...payloadWithoutVat } = payload
    const retry = await supabase
      .from('products')
      .insert(payloadWithoutVat)
      .select()
      .single()
    product = retry.data
    error = retry.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product })
}
