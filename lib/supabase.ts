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
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
