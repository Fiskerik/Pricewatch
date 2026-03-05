import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const shop = url.searchParams.get('shop')
  const state = url.searchParams.get('state')
  const hmac = url.searchParams.get('hmac')
  
  // Verify state (CSRF protection)
  const cookieState = req.cookies.get('shopify_oauth_state')?.value
  if (state !== cookieState) {
    return NextResponse.redirect(new URL('/dashboard?error=invalid_state', req.url))
  }
  
  // Verify HMAC
  const params = new URLSearchParams(url.search)
  params.delete('hmac')
  const message = params.toString()
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex')
  
  if (hash !== hmac) {
    return NextResponse.redirect(new URL('/dashboard?error=invalid_hmac', req.url))
  }

  // Exchange code for access token
  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    })

    const { access_token } = await tokenResponse.json()

    if (!access_token) {
      throw new Error('No access token received')
    }

    // Save store with access token
    const { data: store, error } = await supabaseAdmin()
      .from('stores')
      .update({ 
        shop_domain: shop, 
        access_token: access_token 
      })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error || !store) {
      throw new Error('Failed to save store')
    }

    // Fetch and sync products
    const productsResponse = await fetch(
      `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images,variants`,
      {
        headers: {
          'X-Shopify-Access-Token': access_token,
          'Content-Type': 'application/json',
        },
      }
    )

    const { products } = await productsResponse.json()

    // Insert products
    for (const product of products || []) {
      const mainVariant = product.variants?.[0]
      await supabaseAdmin()
        .from('products')
        .upsert({
          store_id: store.id,
          shopify_product_id: String(product.id),
          title: product.title,
          handle: product.handle,
          image_url: product.images?.[0]?.src ?? null,
          our_price: mainVariant?.price ? parseFloat(mainVariant.price) : null,
        }, { 
          onConflict: 'shopify_product_id,store_id' 
        })
    }

    // Clear state cookie
    const response = NextResponse.redirect(new URL('/dashboard?connected=true', req.url))
    response.cookies.delete('shopify_oauth_state')
    
    return response
  } catch (err) {
    console.error('Shopify callback error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=shopify', req.url))
  }
}
