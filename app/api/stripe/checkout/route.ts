import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { stripe, PLANS, createCheckoutSession } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json()
  if (!plan || !PLANS[plan as keyof typeof PLANS]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const { data: store } = await supabase
    .from('stores')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  const session = await createCheckoutSession({
    customerId: store?.stripe_customer_id ?? undefined,
    priceId: PLANS[plan as keyof typeof PLANS].priceId,
    userId: user.id,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  })

  return NextResponse.json({ url: session.url })
}
