import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api'
import '@shopify/shopify-api/adapters/node'

let shopifyClient: ReturnType<typeof shopifyApi> | null = null

export const getShopifyClient = () => {
  if (shopifyClient) return shopifyClient

  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecretKey = process.env.SHOPIFY_API_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!apiKey || !apiSecretKey || !appUrl) {
    throw new Error('Missing Shopify configuration: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, and NEXT_PUBLIC_APP_URL are required.')
  }

  shopifyClient = shopifyApi({
    apiKey,
    apiSecretKey,
    scopes: ['read_products'],
    hostName: new URL(appUrl).hostname,
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: false,
  })

  return shopifyClient
}

export async function getShopifyProducts(shop: string, accessToken: string) {
  const client = new (getShopifyClient()).clients.Rest({
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
