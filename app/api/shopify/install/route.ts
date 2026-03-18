import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const shop = url.searchParams.get('shop')

  if (!shop) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Validera att det ser ut som ett Shopify-domännamn
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop.toLowerCase())) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Skicka direkt vidare till OAuth-flödet
  return NextResponse.redirect(
    new URL(`/api/shopify/auth?shop=${encodeURIComponent(shop)}`, req.url)
  )
}
