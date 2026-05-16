import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  const host = searchParams.get("host");

  if (!code || !shop) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=Missing+parameters`);
  }

  try {
    // Exchange temporary code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connect-shopify?error=OAuth+failed`);
    }

    const accessToken = tokenData.access_token;
    const supabase = createClient();

    // Fetch shop details to get latest store info if needed
    const shopResponse = await fetch(`https://${shop}/admin/api/2024-04/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    const shopData = await shopResponse.json();
    const shopInfo = shopData?.shop || {};

    // Check if this shop domain is ALREADY connected to an existing account
    const { data: existingStore } = await supabase
      .from("stores")
      .select("user_id")
      .eq("myshopify_domain", shop)
      .maybeSingle();

    if (existingStore) {
      // Look up the profile/auth email belonging to the connected user_id
      const { data: userData } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", existingStore.user_id)
        .maybeSingle();

      // Fallback to checking auth side if profiles table email is empty
      const targetEmail = userData?.email || "another user account";

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connect-shopify?error=${encodeURIComponent(
          `Shopify already connected to email ${targetEmail}`
        )}`
      );
    }

    // Get current authenticated user session trying to connect the store
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=Unauthorized`);
    }

    // Persist new Shopify integration
    await supabase.from("stores").insert({
      user_id: session.user.id,
      myshopify_domain: shop,
      access_token: accessToken,
      shop_name: shopInfo.name || shop,
      currency: shopInfo.currency || "USD",
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?success=connected`);
  } catch (error) {
    console.error("Shopify callback OAuth error:", error);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/connect-shopify?error=Something+went+wrong`);
  }
}
