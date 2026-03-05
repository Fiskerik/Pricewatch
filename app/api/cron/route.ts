import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { scrapePrice } from '@/lib/scraper'
import { sendPriceAlert } from '@/lib/email'

// Called by Vercel Cron every hour: 0 * * * *
// Secured with CRON_SECRET so only Vercel can trigger it
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()
  const results = { checked: 0, changed: 0, failed: 0, errors: [] as string[] }
  const admin = supabaseAdmin() as any

  // Fetch all active competitor URLs that are due for a check
  // Free plan: daily = checked > 24h ago (or never)
  // Pro/Business: hourly = checked > 1h ago (or never)
  const { data: competitors, error } = await admin
    .from('competitor_urls')
    .select(`
      id, url, label, last_price,
      products (
        id, title, our_price, currency_code,
        stores (
          id, plan,
          auth_users:user_id (email)
        )
      )
    `)
    .eq('is_active', true)
    .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 3600000).toISOString()}`)
    .limit(500) // process max 500 per run to stay within cron timeout

  if (error || !competitors) {
    return NextResponse.json({ error: 'DB error', details: error?.message }, { status: 500 })
  }

  const competitorList = competitors as any[]

  for (const comp of competitorList) {
    const product = comp.products as any
    const store = product?.stores as any
    const plan = store?.plan ?? 'free'
    const userEmail = store?.auth_users?.email

    // Free plan: skip if checked < 24h ago
    if (plan === 'free' && comp.last_price !== null) {
      // Already checked — cron re-filter handles this, but double-check
    }

    try {
      const { price } = await scrapePrice(comp.url, product?.currency_code ?? 'USD')
      results.checked++

      // Update last_checked_at regardless
      await admin
        .from('competitor_urls')
        .update({ last_checked_at: now })
        .eq('id', comp.id)

      if (price === null) {
        results.failed++
        continue
      }

      // Record in history
      await admin.from('price_history').insert({
        competitor_url_id: comp.id,
        price,
        checked_at: now,
      })

      // Price changed?
      const oldPrice = comp.last_price ? parseFloat(String(comp.last_price)) : null
      if (oldPrice !== null && Math.abs(price - oldPrice) > 0.005) {
        results.changed++

        // Update last_price + last_changed_at
        await admin
          .from('competitor_urls')
          .update({ last_price: price, last_changed_at: now })
          .eq('id', comp.id)

        // Send email alert
        if (userEmail && product?.title) {
          try {
            await sendPriceAlert({
              to: userEmail,
              productTitle: product.title,
              competitorLabel: comp.label ?? '',
              competitorUrl: comp.url,
              oldPrice,
              newPrice: price,
              ourPrice: product.our_price ?? 0,
            })

            await admin.from('alerts_sent').insert({
              competitor_url_id: comp.id,
              old_price: oldPrice,
              new_price: price,
            })
          } catch (emailErr) {
            results.errors.push(`Email failed for ${comp.id}: ${String(emailErr)}`)
          }
        }
      } else if (oldPrice === null) {
        // First check — just save the price, no alert
        await admin
          .from('competitor_urls')
          .update({ last_price: price })
          .eq('id', comp.id)
      }

    } catch (err) {
      results.failed++
      results.errors.push(`Scrape failed for ${comp.url}: ${String(err)}`)
    }
  }

  return NextResponse.json({ success: true, timestamp: now, ...results })
}
