import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api'
import '@shopify/shopify-api/adapters/node'

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: ['read_products'],
  hostName: new URL(process.env.NEXT_PUBLIC_APP_URL!).hostname,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
})

export async function getShopifyProducts(shop: string, accessToken: string) {
  const client = new shopify.clients.Rest({
    session: new Session({
      id: `${shop}_session`,
      shop,
      state: '',
      isOnline: false,
      accessToken,
    }),
  })

  const response = await client.get({
    path: 'products',
    query: { limit: '250', fields: 'id,title,handle,images,variants' },
  })

  return (response.body as any).products ?? []
}

// Convert Shopify product → our Product shape
export function normalizeShopifyProduct(shopifyProduct: any, storeId: string) {
  const mainVariant = shopifyProduct.variants?.[0]
  return {
    store_id: storeId,
    shopify_product_id: String(shopifyProduct.id),
    title: shopifyProduct.title,
    handle: shopifyProduct.handle,
    image_url: shopifyProduct.images?.[0]?.src ?? null,
    our_price: mainVariant?.price ? parseFloat(mainVariant.price) : null,
  }
}
