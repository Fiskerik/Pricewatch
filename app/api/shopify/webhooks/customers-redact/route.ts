import { NextRequest, NextResponse } from 'next/server'
import { verifyShopifyWebhook } from '../_shared/verify'

export async function POST(req: NextRequest) {
  const { valid, shopDomain, payload } = await verifyShopifyWebhook(req)

  if (!valid) {
    console.warn('[shopify/webhooks/customers-redact] invalid signature', { shopDomain })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  console.log('[shopify/webhooks/customers-redact] received', {
    shopDomain,
    customerId: payload?.customer?.id ?? payload?.customer?.admin_graphql_api_id ?? null,
  })

  return NextResponse.json({ ok: true })
}
