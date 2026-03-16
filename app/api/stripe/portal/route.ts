import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createBillingPortalSession, getStripeClient } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: store } = await supabase
    .from('stores')
    .select('id, stripe_customer_id')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  let stripeCustomerId = store?.stripe_customer_id ?? null

  if (!stripeCustomerId) {
    const customer = await getStripeClient().customers.create({
      email: user.email ?? undefined,
      metadata: { userId: user.id },
    })

    stripeCustomerId = customer.id

    if (store?.id) {
      await supabase
        .from('stores')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', store.id)
        .eq('user_id', user.id)
    }
  }

  if (!stripeCustomerId) {
    return NextResponse.json({ error: 'No Stripe customer found for this account.' }, { status: 404 })
  }

  const session = await createBillingPortalSession(
    stripeCustomerId,
    `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings`
  )

  return NextResponse.json({ url: session.url })
}
