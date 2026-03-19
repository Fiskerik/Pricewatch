import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VALID_REASON_CODES = new Set([
  'too_expensive',
  'missing_features',
  'hard_to_use',
  'not_accurate_enough',
  'technical_issues',
  'switching_tools',
  'temporary_need_only',
  'no_longer_using_shopify',
  'other',
])

const SHOP_REGEX = /^[a-z0-9-]+\.myshopify\.com$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_DETAILS_LENGTH = 20

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const shop = typeof body?.shop === 'string' ? body.shop.trim().toLowerCase() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const reasonCode = typeof body?.reasonCode === 'string' ? body.reasonCode.trim() : ''
    const details = typeof body?.details === 'string' ? body.details.trim() : ''
    const rating = typeof body?.rating === 'number' ? body.rating : null

    if (!SHOP_REGEX.test(shop)) {
      return NextResponse.json({ error: 'A valid Shopify store is required.' }, { status: 400 })
    }

    if (!VALID_REASON_CODES.has(reasonCode)) {
      return NextResponse.json({ error: 'Please select a valid uninstall reason.' }, { status: 400 })
    }

    if (details.length < MIN_DETAILS_LENGTH) {
      return NextResponse.json({ error: `Please enter at least ${MIN_DETAILS_LENGTH} characters.` }, { status: 400 })
    }

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5.' }, { status: 400 })
    }

    const admin = supabaseAdmin()
    const { data: store, error: storeError } = await admin
      .from('stores')
      .select('id, user_id, shop_domain')
      .eq('shop_domain', shop)
      .maybeSingle()

    if (storeError) {
      console.error('[uninstall-feedback] failed to lookup store', { shop, message: storeError.message })
      return NextResponse.json({ error: 'Could not verify the Shopify store.' }, { status: 500 })
    }

    const { error: insertError } = await admin
      .from('uninstall_feedback')
      .insert({
        store_id: store?.id ?? null,
        user_id: store?.user_id ?? null,
        shop_domain: store?.shop_domain ?? shop,
        email,
        reason_code: reasonCode,
        details,
        rating,
      })

    if (insertError) {
      console.error('[uninstall-feedback] failed to save feedback', { shop, message: insertError.message })
      return NextResponse.json({ error: 'Could not save your feedback.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[uninstall-feedback] unexpected error', error)
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 })
  }
}
