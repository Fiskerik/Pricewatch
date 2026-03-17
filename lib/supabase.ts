import { createClient } from '@supabase/supabase-js'
import { createClientComponentClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

// ── Browser client (use in Client Components) ──────────────
export const supabaseBrowser = () =>
  createClientComponentClient()

// ── Server client (use in Server Components & Route Handlers) ─
export const supabaseServer = () =>
  createServerComponentClient({ cookies })

// ── Service role client (use ONLY in cron/server-side writes) ─
// Never expose this to the browser
let adminClient: any = null

export const supabaseAdmin = (): any => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service credentials')
  }

  // Don't cache — env vars may not be ready at module init
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
