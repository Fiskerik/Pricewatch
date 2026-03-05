import { NextRequest, NextResponse } from 'next/server'
import { shopify, getShopifyProducts, normalizeShopifyProduct } from '@/lib/shopify'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: new Response(),
    })

    const { session } = callback
    const { shop, accessToken } = session

    // Save/update store with Shopify credentials
    const { data: store, error } = await supabaseAdmin
      .from('stores')
      .update({ shop_domain: shop, access_token: accessToken })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error || !store) throw new Error('Failed to save store')

    // Sync products from Shopify
    const shopifyProducts = await getShopifyProducts(shop, accessToken!)
    for (const sp of shopifyProducts) {
      const normalized = normalizeShopifyProduct(sp, store.id)
      await supabaseAdmin
        .from('products')
        .upsert(normalized, { onConflict: 'shopify_product_id, store_id' })
    }

    return NextResponse.redirect(new URL('/dashboard?connected=true', req.url))
  } catch (err) {
    console.error('Shopify callback error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=shopify', req.url))
  }
}
