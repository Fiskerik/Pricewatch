// lib/shopify.ts - simplified version
export async function getShopifyProducts(shop: string, accessToken: string) {
  const response = await fetch(
    `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images,variants`,
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    }
  )

  const data = await response.json()
  return data.products ?? []
}
