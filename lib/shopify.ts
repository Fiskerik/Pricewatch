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
export async function updateShopifyVariantPrice(
  shopDomain: string,
  accessToken: string,
  variantId: string,
  newPrice: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://${shopDomain}/admin/api/2024-01/variants/${variantId}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variant: {
            id: variantId,
            price: newPrice.toFixed(2),
          },
        }),
      }
    )

    if (!res.ok) {
      const data = await res.json()
      const message = data?.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`
      return { success: false, error: message }
    }

    const data = await res.json()
    const updatedPrice = parseFloat(data?.variant?.price ?? '0')
    
    console.log('[shopify] variant price updated', {
      shopDomain,
      variantId,
      requestedPrice: newPrice,
      confirmedPrice: updatedPrice,
    })

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
