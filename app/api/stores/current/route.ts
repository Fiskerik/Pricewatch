import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: store } = await supabase
    .from('stores')
    .select('id, shop_domain, plan, is_primary')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(store ?? { shop_domain: null, plan: 'free' })
}
