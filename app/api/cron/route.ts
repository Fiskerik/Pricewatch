import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { scrapePrice } from '@/lib/scraper'
import { sendPriceAlert, sendStockAlert } from '@/lib/email'
import { FailureReasonCode } from '@/lib/scraper/shared'

const MAX_ENQUEUE_PER_RUN = 500
const PROCESS_BATCH_SIZE = 100
const MAX_PROCESS_PER_RUN = 300
const MAX_ATTEMPTS = 5
const BASE_BACKOFF_MINUTES = 15

type JobStatus = 'queued' | 'processing' | 'retrying' | 'success' | 'failed'

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return 'unknown'
  }
}

function getDueThresholdIso(plan: string): string {
  const hours = plan === 'free' ? 24 : 1
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function getNextBackoffIso(attempt: number): string {
  const delayMinutes = Math.min(BASE_BACKOFF_MINUTES * (2 ** Math.max(0, attempt - 1)), 24 * 60)
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
}

async function enqueueDueChecks(admin: any) {
  const now = new Date().toISOString()
  const { data: competitors, error } = await admin
    .from('competitor_urls')
    .select(`
      id, url, last_checked_at,
      products (
        stores (
          plan
        )
      )
    `)
    .eq('is_active', true)
    .limit(MAX_ENQUEUE_PER_RUN)

  if (error || !competitors) {
    throw new Error(`Failed to fetch due competitors: ${error?.message ?? 'unknown error'}`)
  }

  const dueCompetitors = (competitors as any[]).filter(comp => {
    const plan = comp.products?.stores?.plan ?? 'free'
    const threshold = getDueThresholdIso(plan)
    return !comp.last_checked_at || comp.last_checked_at < threshold
  })

  if (dueCompetitors.length === 0) return { enqueued: 0 }

  const competitorIds = dueCompetitors.map(comp => comp.id)
  const { data: existingJobs } = await admin
    .from('scrape_jobs')
    .select('competitor_url_id,status')
    .in('competitor_url_id', competitorIds)
    .in('status', ['queued', 'retrying', 'processing'])

  const activeJobIds = new Set((existingJobs ?? []).map((j: any) => j.competitor_url_id))
  const rows = dueCompetitors
    .filter(comp => !activeJobIds.has(comp.id))
    .map(comp => ({
      status: 'queued' as JobStatus,
      attempts: 0,
      next_attempt_at: now,
      last_error: null,
      failure_reason_code: null,
      domain: getDomainFromUrl(comp.url),
      competitor_url_id: comp.id,
      platform: null,
    }))

  if (rows.length === 0) return { enqueued: 0 }

  const { error: insertError } = await admin
    .from('scrape_jobs')
    .insert(rows)

  if (insertError) {
    throw new Error(`Failed to enqueue jobs: ${insertError.message}`)
  }

  return { enqueued: rows.length }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()
  const admin = supabaseAdmin() as any
  const results = {
    enqueued: 0,
    processed: 0,
    checked: 0,
    changed: 0,
    failed: 0,
    terminal_failed: 0,
    errors: [] as string[],
  }

  try {
    const enqueueResult = await enqueueDueChecks(admin)
    results.enqueued = enqueueResult.enqueued
  } catch (err) {
    return NextResponse.json({ error: 'Failed to enqueue jobs', details: String(err) }, { status: 500 })
  }

  while (results.processed < MAX_PROCESS_PER_RUN) {
    const remaining = MAX_PROCESS_PER_RUN - results.processed
    const batchSize = Math.min(PROCESS_BATCH_SIZE, remaining)
    const dueIso = new Date().toISOString()

    const { data: jobs, error: jobsError } = await admin
      .from('scrape_jobs')
      .select(`
        id, status, attempts, domain, competitor_url_id,
        competitor_urls (
          id, url, label, last_price, last_price_currency, selected_price_metric, mock_next_price, mock_price_enabled,
          last_stock_status,
          products (
            id, title, our_price, currency_code,
            stores (
              id, plan,
              auth_users:user_id (email)
            )
          )
        )
      `)
      .in('status', ['queued', 'retrying'])
      .lte('next_attempt_at', dueIso)
      .order('next_attempt_at', { ascending: true })
      .limit(batchSize)

    if (jobsError) {
      results.errors.push(`Job fetch failed: ${jobsError.message}`)
      break
    }

    const jobList = (jobs ?? []) as any[]
    if (jobList.length === 0) break

    const jobIds = jobList.map(job => job.id)
    await admin
      .from('scrape_jobs')
      .update({ status: 'processing' })
      .in('id', jobIds)

    for (const job of jobList) {
      const comp = job.competitor_urls
      const product = comp?.products
      const store = product?.stores
      const userEmail = store?.auth_users?.email
      const nextAttempt = (job.attempts ?? 0) + 1

      results.processed++

      if (!comp?.id || !comp?.url) {
        results.failed++
        results.terminal_failed++
        await admin.from('scrape_jobs').update({
          status: 'failed',
          attempts: nextAttempt,
          next_attempt_at: null,
          last_error: 'Competitor URL missing for job',
          failure_reason_code: 'parse_fail',
        }).eq('id', job.id)
        continue
      }

      try {
        const mockPrice = Number(comp.mock_next_price)
        const hasMockPrice = comp.mock_price_enabled === true && Number.isFinite(mockPrice) && mockPrice > 0
        const scrapeResult = hasMockPrice
          ? {
              price: mockPrice,
              scrapedCurrency: comp.last_price_currency ?? product?.currency_code ?? 'USD',
              method: 'mock_override',
              error: null,
              platform: 'mock',
              failureCode: null,
              candidates: [],
              metricUsed: 'mock_override',
              matchedPreferredMetric: true,
              stockStatus: comp.last_stock_status ?? 'unknown',
              stockSource: 'mock_override',
            }
          : await scrapePrice(comp.url, product?.currency_code ?? 'USD', {
              preferredMetric: comp.selected_price_metric ?? null,
            })
        const savedDecimalShift = (comp as any).price_decimal_shift ?? 0
        const savedCurrencyOverride = (comp as any).price_currency_override ?? null
        
        if (scrapeResult.price !== null && savedDecimalShift !== 0) {
          scrapeResult.price = scrapeResult.price / Math.pow(10, savedDecimalShift)
          scrapeResult.price = Math.round(scrapeResult.price * 1_000_000) / 1_000_000
        }
        if (savedCurrencyOverride && scrapeResult.price !== null) {
          scrapeResult.scrapedCurrency = savedCurrencyOverride
        }
        if (hasMockPrice) {
          console.log('[cron] using mock override price', {
            competitorId: comp.id,
            mockPrice,
          })
        }

        await admin
          .from('competitor_urls')
          .update({
            last_checked_at: now,
            ...(hasMockPrice
              ? {
                  mock_next_price: null,
                  mock_price_enabled: false,
                  mock_set_at: null,
                }
              : {}),
          })
          .eq('id', comp.id)

        if (scrapeResult.price === null) {
          const failureCode: FailureReasonCode = scrapeResult.failureCode ?? 'no_candidate'
          const failMessage = scrapeResult.error ?? 'Price extraction failed'
          const isTerminal = nextAttempt >= MAX_ATTEMPTS

          results.failed++
          if (isTerminal) results.terminal_failed++

          await admin.from('scrape_jobs').update({
            status: isTerminal ? 'failed' : 'retrying',
            attempts: nextAttempt,
            next_attempt_at: isTerminal ? null : getNextBackoffIso(nextAttempt),
            last_error: failMessage,
            failure_reason_code: failureCode,
            platform: scrapeResult.platform ?? null,
          }).eq('id', job.id)

          continue
        }

        results.checked++

        await admin.from('price_history').insert({
          competitor_url_id: comp.id,
          price: scrapeResult.price,
          checked_at: now,
        })

        const oldPrice = comp.last_price ? parseFloat(String(comp.last_price)) : null
        const oldStockStatus = typeof comp.last_stock_status === 'string' ? comp.last_stock_status : 'unknown'
        const newStockStatus = scrapeResult.stockStatus

        if (newStockStatus !== 'unknown' && oldStockStatus !== newStockStatus) {
          await admin
            .from('competitor_urls')
            .update({
              last_stock_status: newStockStatus,
              last_stock_changed_at: now,
            })
            .eq('id', comp.id)

          if (userEmail && product?.title) {
            try {
              await sendStockAlert({
                to: userEmail,
                productTitle: product.title,
                competitorLabel: comp.label ?? '',
                competitorUrl: comp.url,
                previousStatus: oldStockStatus,
                newStatus: newStockStatus,
              })

              await admin.from('alerts_sent').insert({
                competitor_url_id: comp.id,
                old_price: oldPrice,
                new_price: scrapeResult.price,
                alert_type: newStockStatus === 'out_of_stock' ? 'stock_out' : 'restocked',
              })
            } catch (emailErr) {
              results.errors.push(`Stock email failed for ${comp.id}: ${String(emailErr)}`)
            }
          }
        }

        if (oldPrice !== null && Math.abs(scrapeResult.price - oldPrice) > 0.005) {
          results.changed++

          await admin
            .from('competitor_urls')
            .update({
              last_price: scrapeResult.price,
              last_price_currency: scrapeResult.scrapedCurrency,
              last_changed_at: now,
            })
            .eq('id', comp.id)

          const confidence = typeof comp.match_confidence === 'number' ? comp.match_confidence : 1
          const mismatchReasons = Array.isArray(comp.mismatch_reasons) ? comp.mismatch_reasons : []
          const suppressAlert = confidence < 0.45 || mismatchReasons.length > 0

          if (suppressAlert) {
            console.log('[cron] alert suppressed due to potential mismatch', {
              competitorId: comp.id,
              confidence,
              mismatchReasons,
            })
          }

          if (!suppressAlert && userEmail && product?.title) {
            try {
              await sendPriceAlert({
                to: userEmail,
                productTitle: product.title,
                competitorLabel: comp.label ?? '',
                competitorUrl: comp.url,
                oldPrice,
                newPrice: scrapeResult.price,
                ourPrice: product.our_price ?? 0,
              })

              await admin.from('alerts_sent').insert({
                competitor_url_id: comp.id,
                old_price: oldPrice,
                new_price: scrapeResult.price,
                alert_type: 'price_change',
              })
            } catch (emailErr) {
              results.errors.push(`Email failed for ${comp.id}: ${String(emailErr)}`)
            }
          }
        } else if (oldPrice === null) {
          await admin
            .from('competitor_urls')
            .update({
              last_price: scrapeResult.price,
              last_price_currency: scrapeResult.scrapedCurrency,
            })
            .eq('id', comp.id)
        }

        await admin.from('scrape_jobs').update({
          status: 'success',
          attempts: nextAttempt,
          next_attempt_at: null,
          last_error: null,
          failure_reason_code: null,
          platform: scrapeResult.platform ?? null,
        }).eq('id', job.id)
      } catch (err) {
        const errorText = String(err)
        const lowered = errorText.toLowerCase()
        const failureCode: FailureReasonCode = lowered.includes('timeout') || lowered.includes('abort')
          ? 'timeout'
          : lowered.includes('403') || lowered.includes('429') || lowered.includes('captcha') || lowered.includes('blocked')
            ? 'blocked'
            : 'parse_fail'
        const isTerminal = nextAttempt >= MAX_ATTEMPTS

        results.failed++
        if (isTerminal) results.terminal_failed++
        results.errors.push(`Scrape failed for ${comp.url}: ${errorText}`)

        await admin.from('scrape_jobs').update({
          status: isTerminal ? 'failed' : 'retrying',
          attempts: nextAttempt,
          next_attempt_at: isTerminal ? null : getNextBackoffIso(nextAttempt),
          last_error: errorText,
          failure_reason_code: failureCode,
        }).eq('id', job.id)
      }
    }
  }

  return NextResponse.json({ success: true, timestamp: now, ...results })
}
