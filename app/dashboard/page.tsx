import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch store
  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // Fetch products with their competitor URLs and latest price history
  const { data: products } = await supabase
    .from('products')
    .select(`
      *,
      competitor_urls (
        *,
        price_history (price, checked_at)
      )
    `)
    .eq('store_id', store?.id ?? '')
    .order('created_at', { ascending: false })

  // Fetch recent alerts
  const { data: alerts } = await supabase
    .from('alerts_sent')
    .select(`
      *,
      competitor_urls (
        label, url,
        products (title)
      )
    `)
    .order('sent_at', { ascending: false })
    .limit(10)

  return (
    <DashboardClient
      user={user}
      store={store}
      initialProducts={products ?? []}
      initialAlerts={alerts ?? []}
    />
  )
}
