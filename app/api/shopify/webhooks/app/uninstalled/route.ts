import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyShopifyWebhook } from '../../_shared/verify'

export async function POST(req: NextRequest) {
  const { valid, shopDomain } = await verifyShopifyWebhook(req)
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  // När appen avinstalleras → degradera till free
  await supabaseAdmin()
    .from('stores')
    .update({
      plan: 'free',
      shopify_charge_id: null,
      access_token: null,
    })
    .eq('shop_domain', shopDomain)

  return NextResponse.json({ ok: true })
}
