import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { sendPriceAlert } from '@/lib/email'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { competitorId, newPrice } = await req.json()
    const parsedNewPrice = Number(newPrice)

    if (!competitorId || !Number.isFinite(parsedNewPrice) || parsedNewPrice <= 0) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    }

    const { data: competitor, error: competitorError } = await supabase
      .from('competitor_urls')
      .select(`
        id, label, url, last_price, last_price_currency,
        products!inner (
          title, our_price,
          stores!inner (
            user_id
          )
        )
      `)
      .eq('id', competitorId)
      .eq('products.stores.user_id', user.id)
      .single()

    if (competitorError || !competitor) {
      console.log('[mock/send-alert] competitor lookup failed', {
        userId: user.id,
        competitorId,
        competitorError: competitorError?.message ?? null,
      })
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const email = user.email
    const title = (competitor as any)?.products?.title

    if (!email || !title) {
      return NextResponse.json({ error: 'Missing recipient or product data' }, { status: 400 })
    }

    const oldPrice = (competitor as any)?.last_price
    if (typeof oldPrice !== 'number' || !Number.isFinite(oldPrice)) {
      return NextResponse.json({ error: 'Selected competitor has no existing baseline price yet.' }, { status: 400 })
    }

    console.log('[mock/send-alert] attempting test alert send', {
      userId: user.id,
      competitorId,
      email,
      emailProvider: process.env.EMAIL_PROVIDER ?? 'resend',
      hasResendKey: Boolean(process.env.RESEND_KEY),
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
      emailFrom: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
      oldPrice,
      newPrice: parsedNewPrice,
    })

    const sendResult = await sendPriceAlert({
      to: email,
      productTitle: title,
      competitorLabel: (competitor as any)?.label ?? '',
      competitorUrl: (competitor as any)?.url,
      oldPrice,
      newPrice: parsedNewPrice,
      ourPrice: (competitor as any)?.products?.our_price ?? 0,
      currency: (competitor as any)?.last_price_currency ?? 'USD',
    })

    if (sendResult.skipped) {
      console.log('[mock/send-alert] skipped test alert send', {
        userId: user.id,
        competitorId,
        email,
        sendResult,
      })
      return NextResponse.json({
        error: 'Email provider is not configured. Set RESEND_KEY or RESEND_API_KEY and retry.',
        sendResult,
      }, { status: 503 })
    }

    console.log('[mock/send-alert] sent test alert', {
      userId: user.id,
      competitorId,
      email,
      oldPrice,
      newPrice: parsedNewPrice,
      sendResult,
    })

    return NextResponse.json({
      sent: true,
      sendResult,
      debug: {
        hasResendKey: Boolean(process.env.RESEND_KEY),
        hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
        emailFrom: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
        emailProvider: process.env.EMAIL_PROVIDER ?? 'resend',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error while sending test email'

    console.error('[mock/send-alert] test alert send failed', {
      userId: user.id,
      error: message,
    })

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
