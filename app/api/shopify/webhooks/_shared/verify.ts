import crypto from 'crypto'
import { NextRequest } from 'next/server'

export async function verifyShopifyWebhook(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const shopDomain = req.headers.get('x-shopify-shop-domain')
  const topic = req.headers.get('x-shopify-topic')

  const body = await req.text()
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET || '')
    .update(body, 'utf8')
    .digest('base64')

  const valid = Boolean(hmac) && digest === hmac

  let payload: any = {}
  if (body) {
    try {
      payload = JSON.parse(body)
    } catch {
      payload = {}
    }
  }

  return {
    valid,
    shopDomain,
    topic,
    body,
    payload,
  }
}
