import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function DELETE(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productId } = await req.json()
  if (!productId) return NextResponse.json({ error: 'Missing productId' }, { status: 400 })

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, store_id')
    .eq('id', productId)
    .single()

  if (productError) {
    console.log('[products/delete] failed loading product', { productId, userId: user.id, error: productError.message })
  }

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id')
    .eq('id', product.store_id)
    .eq('user_id', user.id)
    .single()

  if (storeError) {
    console.log('[products/delete] failed loading store ownership', { productId, userId: user.id, error: storeError.message })
  }

  if (!store) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { error: competitorDeleteError } = await supabase
    .from('competitor_urls')
    .delete()
    .eq('product_id', productId)

  if (competitorDeleteError) {
    console.log('[products/delete] failed deleting competitors', { productId, userId: user.id, error: competitorDeleteError.message })
    return NextResponse.json({ error: competitorDeleteError.message }, { status: 500 })
  }

  const { error: productDeleteError } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)

  if (productDeleteError) {
    console.log('[products/delete] failed deleting product', { productId, userId: user.id, error: productDeleteError.message })
    return NextResponse.json({ error: productDeleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
