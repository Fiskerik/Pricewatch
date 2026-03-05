import Stripe from 'stripe'

let stripeClient: Stripe | null = null

export const getStripeClient = () => {
  if (stripeClient) return stripeClient

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required for Stripe operations.')
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  })

  return stripeClient
}

export const PLANS = {
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID || '',
    name: 'Pro',
    amount: 1500, // $15.00
  },
  business: {
    priceId: process.env.STRIPE_BUSINESS_PRICE_ID || '',
    name: 'Business',
    amount: 3900, // $39.00
  },
}

export async function createCheckoutSession({
  customerId,
  priceId,
  userId,
  returnUrl,
}: {
  customerId?: string
  priceId: string
  userId: string
  returnUrl: string
}) {
  return getStripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId },
    success_url: `${returnUrl}?upgraded=true`,
    cancel_url: `${returnUrl}?cancelled=true`,
    allow_promotion_codes: true,
  })
}

export async function createBillingPortalSession(customerId: string, returnUrl: string) {
  return getStripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}
