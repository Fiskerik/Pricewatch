import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function PATCH(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId, url, label } = await req.json()
  if (!competitorId || !url) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: competitorWithOwner } = await supabase
    .from('competitor_urls')
    .select('id, products!inner(stores!inner(user_id))')
    .eq('id', competitorId)
    .eq('products.stores.user_id', user.id)
    .single()

  if (!competitorWithOwner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: competitor, error } = await supabase
    .from('competitor_urls')
    .update({ url, label: label || null })
    .eq('id', competitorId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ competitor })
}
