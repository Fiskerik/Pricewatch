import { NextRequest, NextResponse } from 'next/server'
import { getStripeClient } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = getStripeClient().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook signature failed' }, { status: 400 })
  }

  const planFromPriceId = (priceId?: string) => {
    if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro'
    if (priceId === process.env.STRIPE_BUSINESS_PRICE_ID) return 'business'
    return 'free'
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.userId
      if (!userId) break

      await supabaseAdmin()
        .from('stores')
        .update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
        })
        .eq('user_id', userId)
      break
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription
      const priceId = sub.items.data[0]?.price.id
      const plan = planFromPriceId(priceId)

      await supabaseAdmin()
        .from('stores')
        .update({ plan, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer as string)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await supabaseAdmin()
        .from('stores')
        .update({ plan: 'free', stripe_subscription_id: null })
        .eq('stripe_customer_id', sub.customer as string)
      break
    }
  }

  return NextResponse.json({ received: true })
}
