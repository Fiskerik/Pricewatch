# Pricingspy

Competitor price tracker for Shopify sellers. Paste a URL. Get an email when the price changes.

## Quick Start

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/pricingspy
cd pricingspy
npm install
```

### 2. Set up Supabase
1. Go to [supabase.com](https://supabase.com) → New project
2. SQL Editor → Paste contents of `supabase-schema.sql` → Run
3. Settings → API → copy your URL and keys

### 3. Set up environment variables
```bash
cp .env.local.example .env.local
# Fill in all values in .env.local
```

### 4. Set up Shopify Partner App
1. [partners.shopify.com](https://partners.shopify.com) → Apps → Create App
2. Set redirect URL: `http://localhost:3000/api/shopify/callback`
3. Scopes: `read_products`
4. Copy API Key + Secret to `.env.local`

### 5. Set up Stripe
1. [stripe.com/dashboard](https://dashboard.stripe.com) → Products → Create 2 products:
   - **Pro**: $15/month recurring → copy Price ID to `STRIPE_PRO_PRICE_ID`
   - **Business**: $39/month recurring → copy to `STRIPE_BUSINESS_PRICE_ID`
2. Developers → Webhooks → Add endpoint:
   - URL: `https://yourapp.vercel.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

### 6. Run locally
```bash
npm run dev
# Open http://localhost:3000
```

### 7. Deploy to Vercel
```bash
npm i -g vercel
vercel
# Add all env vars in Vercel dashboard → Settings → Environment Variables
# Vercel will auto-detect vercel.json and set up the hourly cron
```

## Architecture
- **Next.js 14** — frontend + API routes
- **Supabase** — Postgres database + magic link auth
- **Vercel Cron** — hourly price checks (free)
- **Resend** — email alerts
- **Stripe** — subscriptions
- **Cheerio + ScraperAPI** — price scraping

## File Structure
```
app/
  page.tsx                    Landing page
  dashboard/
    page.tsx                  Dashboard (server, fetches data)
    DashboardClient.tsx        Dashboard (client, interactive)
  api/
    scrape/route.ts           Instant price check
    products/add/route.ts     Add product
    competitors/
      add/route.ts            Add competitor URL
      delete/route.ts         Delete competitor URL
    cron/route.ts             Hourly price check job
    shopify/
      auth/route.ts           Start Shopify OAuth
      callback/route.ts       Handle OAuth callback + sync
    stripe/
      checkout/route.ts       Create Stripe checkout
      portal/route.ts         Open billing portal
      webhook/route.ts        Handle Stripe events
lib/
  supabase.ts                 Supabase clients
  scraper.ts                  Price scraping (Cheerio → ScraperAPI)
  email.ts                    Alert emails (Resend)
  stripe.ts                   Stripe helpers
  shopify.ts                  Shopify API helpers
components/
  Sidebar.tsx
  ProductCard.tsx
  AddCompetitorModal.tsx
  AddProductModal.tsx
  AlertBadge.tsx
types/index.ts                TypeScript types + plan limits
```
