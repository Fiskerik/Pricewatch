import crypto from 'crypto'
import { NextRequest } from 'next/server'

const SHOPIFY_HMAC_HEADER = 'x-shopify-hmac-sha256'
const SHOPIFY_SHOP_HEADER = 'x-shopify-shop-domain'
const SHOPIFY_TOPIC_HEADER = 'x-shopify-topic'

export async function verifyShopifyWebhook(req: NextRequest) {
  const hmac = req.headers.get(SHOPIFY_HMAC_HEADER)
  const shopDomain = req.headers.get(SHOPIFY_SHOP_HEADER)
  const topic = req.headers.get(SHOPIFY_TOPIC_HEADER)
  const secret = process.env.SHOPIFY_API_SECRET || ''

  const body = await req.text()
  const digest = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64')
  const hmacValue = hmac ?? ''

  const valid = Boolean(hmac)
    && Buffer.byteLength(digest) === Buffer.byteLength(hmacValue)
    && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacValue))

  let payload: any = {}
  if (body) {
    try {
      payload = JSON.parse(body)
    } catch (error) {
      console.warn('[shopify/webhooks] failed to parse JSON payload', {
        topic,
        shopDomain,
        error: error instanceof Error ? error.message : String(error),
      })
      payload = {}
    }
  }

  console.log('[shopify/webhooks] verification result', {
    topic,
    shopDomain,
    hasHmacHeader: Boolean(hmac),
    bodyLength: body.length,
    valid,
  })

  return {
    valid,
    shopDomain,
    topic,
    body,
    payload,
  }
}
