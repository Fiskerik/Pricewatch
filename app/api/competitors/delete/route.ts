import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function DELETE(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { competitorId } = await req.json()

  // Verify ownership
  const { data: comp } = await supabase
    .from('competitor_urls')
    .select('id, products!inner(stores!inner(user_id))')
    .eq('id', competitorId)
    .eq('products.stores.user_id', user.id)
    .single()

  if (!comp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabase.from('competitor_urls').delete().eq('id', competitorId)
  return NextResponse.json({ success: true })
}
