import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const storeId = searchParams.get('storeId')

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 })
  }

  // Verify user owns this store
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('id, shop_domain, access_token')
    .eq('id', storeId)
    .eq('user_id', user.id)
    .single()

  if (storeError || !store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  }

  if (!store.shop_domain || !store.access_token) {
    return NextResponse.json({ error: 'Store not connected to Shopify' }, { status: 400 })
  }

  try {
    // Fetch products from Shopify
    const shopifyResponse = await fetch(
      `https://${store.shop_domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images,variants`,
      {
        headers: {
          'X-Shopify-Access-Token': store.access_token,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!shopifyResponse.ok) {
      throw new Error(`Shopify API error: ${shopifyResponse.status}`)
    }

    const { products } = await shopifyResponse.json()

    // Transform to simpler format
    const formattedProducts = (products || []).map((p: any) => ({
      shopify_product_id: String(p.id),
      title: p.title,
      handle: p.handle,
      image_url: p.images?.[0]?.src ?? null,
      price: p.variants?.[0]?.price ? parseFloat(p.variants[0].price) : null,
    }))

    return NextResponse.json({ products: formattedProducts })
  } catch (error) {
    console.error('[shopify/products] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch Shopify products' },
      { status: 500 }
    )
  }
}
