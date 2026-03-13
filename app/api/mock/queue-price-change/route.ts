import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const admin = supabaseAdmin() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId, mockPrice } = await req.json()
  const parsedPrice = Number(mockPrice)

  if (!competitorId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
  }

  const { data: ownedCompetitor } = await supabase
    .from('competitor_urls')
    .select('id, products!inner(stores!inner(user_id))')
    .eq('id', competitorId)
    .eq('products.stores.user_id', user.id)
    .single()

  if (!ownedCompetitor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: updated, error } = await admin
    .from('competitor_urls')
    .update({
      mock_next_price: parsedPrice,
      mock_price_enabled: true,
      mock_set_at: new Date().toISOString(),
    })
    .eq('id', competitorId)
    .select('id, mock_next_price, mock_price_enabled')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  console.log('[mock/queue-price-change] queued', {
    userId: user.id,
    competitorId,
    mockPrice: parsedPrice,
  })

  return NextResponse.json({ queued: true, competitor: updated })
}
