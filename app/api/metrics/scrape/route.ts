import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

interface Bucket {
  key: string
  domain: string
  platform: string
  total: number
  success: number
}

interface ScrapeJobMetricRow {
  domain: string | null
  platform: string | null
  status: string
  failure_reason_code: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const daysParam = Number(req.nextUrl.searchParams.get('days') ?? '30')
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const admin = supabaseAdmin() as any

  const { data, error } = await admin
    .from('scrape_jobs')
    .select('domain, platform, status, failure_reason_code, created_at')
    .gte('created_at', since)

  if (error) {
    return NextResponse.json({ error: 'Failed to load metrics', details: error.message }, { status: 500 })
  }

  const jobs = (data ?? []) as ScrapeJobMetricRow[]
  const buckets = new Map<string, Bucket>()
  const failuresByReason: Record<string, number> = {
    timeout: 0,
    blocked: 0,
    parse_fail: 0,
    no_candidate: 0,
  }

  for (const row of jobs) {
    const domain = row.domain || 'unknown'
    const platform = row.platform || 'unknown'
    const key = `${domain}::${platform}`
    const bucket = buckets.get(key) ?? {
      key,
      domain,
      platform,
      total: 0,
      success: 0,
    }

    bucket.total += 1
    if (row.status === 'success') bucket.success += 1
    buckets.set(key, bucket)

    if (row.status === 'failed' || row.status === 'retrying') {
      const reason = row.failure_reason_code || 'parse_fail'
      if (typeof failuresByReason[reason] === 'number') failuresByReason[reason] += 1
    }
  }

  const successRates = Array.from(buckets.values())
    .map(bucket => ({
      domain: bucket.domain,
      platform: bucket.platform,
      total: bucket.total,
      success: bucket.success,
      success_rate: bucket.total > 0 ? Number((bucket.success / bucket.total).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({
    window_days: days,
    generated_at: new Date().toISOString(),
    totals: {
      jobs: jobs.length,
      successes: successRates.reduce((sum, bucket) => sum + bucket.success, 0),
      failures: jobs.filter(row => row.status === 'failed' || row.status === 'retrying').length,
    },
    failure_reasons: failuresByReason,
    success_rates: successRates,
  })
}
