import { NextResponse } from 'next/server';
import { createShopifyAdminClient } from '@/lib/shopify'; // your existing helper

export async function POST(request: Request) {
  const { plan } = await request.json();

  // Get the current user's connected store
  // ... (keep your existing Supabase logic to fetch the store)

  const { data: store } = await supabaseAdmin()
    .from('stores')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!store?.access_token || !store.shop_domain) {
    return NextResponse.json({ error: 'Please connect a Shopify store first' }, { status: 400 });
  }

  const shopify = createShopifyAdminClient(store.shop_domain, store.access_token);

  const price = plan === 'business' ? '39' : '15';
  const planName = plan === 'business' ? 'Business Plan' : 'Pro Plan';

  try {
    const response = await shopify.graphql(`
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $price: Decimal!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: true  # Set to false in production
          lineItems: [{
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $price, interval: EVERY_30_DAYS }
              }
            }
          }]
        ) {
          userErrors {
            field
            message
          }
          confirmationUrl
          appSubscription {
            id
          }
        }
      }
    `, {
      name: planName,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/shopify/billing/callback`,
      price: price,
    });

    const { data } = response;

    if (data.appSubscriptionCreate.userErrors?.length > 0) {
      console.error(data.appSubscriptionCreate.userErrors);
      return NextResponse.json({ 
        error: data.appSubscriptionCreate.userErrors[0].message 
      }, { status: 400 });
    }

    return NextResponse.json({ 
      url: data.appSubscriptionCreate.confirmationUrl 
    });

  } catch (error: any) {
    console.error('[Shopify Billing] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to create Shopify charge. Please try again.' 
    }, { status: 500 });
  }
}
