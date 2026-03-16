import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { normalizeCurrencyCode } from '@/lib/currency'

export async function PATCH(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

 const { productId, title, ourPrice, currencyCode, vatIncluded, imageUrl, mapFloorPrice, mapEnabled } = await req.json()
  if (!productId || !title) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, store_id')
    .eq('id', productId)
    .single()

  if (productError) {
    console.log('[products/update] failed loading product', { productId, userId: user.id, error: productError.message })
  }

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id')
    .eq('id', product.store_id)
    .eq('user_id', user.id)
    .single()

  if (storeError) {
    console.log('[products/update] failed loading store ownership', { productId, userId: user.id, error: storeError.message })
  }

  if (!store) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const updatePayload = {
    title: String(title).trim(),
    our_price: typeof ourPrice === 'number' && Number.isFinite(ourPrice) ? ourPrice : null,
    currency_code: normalizeCurrencyCode(currencyCode),
    vat_included: typeof vatIncluded === 'boolean' ? vatIncluded : false,
    image_url: typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null,
    map_floor_price: typeof mapFloorPrice === 'number' && mapFloorPrice > 0 ? mapFloorPrice : null,
    map_enabled: typeof mapEnabled === 'boolean' ? mapEnabled : false,
  }

  let { data, error } = await supabase
    .from('products')
    .update(updatePayload)
    .eq('id', productId)
    .select()
    .single()

  if (error?.message?.includes("'vat_included'")) {
    console.log('[products/update] vat_included column missing in products table, retrying without vat_included', { productId, userId: user.id })
    const { vat_included: _ignoredVatIncluded, ...payloadWithoutVat } = updatePayload
    const retry = await supabase
      .from('products')
      .update(payloadWithoutVat)
      .eq('id', productId)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) {
    console.log('[products/update] update failed', { productId, userId: user.id, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}
