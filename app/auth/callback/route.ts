import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    await supabase.auth.exchangeCodeForSession(code)

    // Ensure the user has a store row
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('stores').upsert({ user_id: user.id }, { onConflict: 'user_id' })
    }
  }

  return NextResponse.redirect(new URL('/dashboard', req.url))
}
