import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { normalizeCurrencyCode } from '@/lib/currency'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productId, currencyCode } = await req.json()
  if (!productId || !currencyCode) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const normalizedCurrencyCode = normalizeCurrencyCode(currencyCode)

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, store_id')
    .eq('id', productId)
    .single()

  if (productError) {
    console.log('[products/currency] failed loading product', { productId, userId: user.id, error: productError.message })
  }

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id')
    .eq('id', product.store_id)
    .eq('user_id', user.id)
    .single()

  if (storeError) {
    console.log('[products/currency] failed loading store ownership', { productId, userId: user.id, error: storeError.message })
  }

  if (!store) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('products')
    .update({ currency_code: normalizedCurrencyCode })
    .eq('id', productId)
    .select('id, currency_code')
    .single()

  if (error) {
    console.log('[products/currency] update failed', { productId, userId: user.id, currencyCode: normalizedCurrencyCode, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}
