import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productId, url, label, initialPrice } = await req.json()
  if (!productId || !url) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify ownership: product → store → user
  const { data: product } = await supabase
    .from('products')
    .select('id, stores!inner(user_id)')
    .eq('id', productId)
    .eq('stores.user_id', user.id)
    .single()

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Insert competitor URL
  const { data: competitor, error } = await supabase
    .from('competitor_urls')
    .insert({
      product_id: productId,
      url,
      label: label || null,
      last_price: initialPrice ?? null,
      last_checked_at: initialPrice ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Record initial price in history
  if (initialPrice && competitor) {
    await supabase.from('price_history').insert({
      competitor_url_id: competitor.id,
      price: initialPrice,
    })
  }

  return NextResponse.json({ competitor })
}
