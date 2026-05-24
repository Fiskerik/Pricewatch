import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { isTestUserEmail } from '@/lib/auth'
import { getPlanUsageStatus } from '@/lib/planLimits'

export default async function DashboardPage() {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch store — create it if it doesn't exist yet
  let { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!store) {
    const { data: newStore } = await supabase
      .from('stores')
      .insert({ user_id: user.id, plan: isTestUserEmail(user.email) ? 'pro' : 'free', email: user.email })
      .select()
      .single()
    store = newStore
  }

  if (store && isTestUserEmail(user.email) && store.plan !== 'pro') {
    const { data: updatedStore } = await supabase
      .from('stores')
      .update({ plan: 'pro' })
      .eq('id', store.id)
      .select()
      .single()

    if (updatedStore) {
      store = updatedStore
    }
  }

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

  const planUsage = getPlanUsageStatus(store?.plan, (products ?? []) as any)

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
      initialPlanPaused={planUsage.isPaused}
    />
  )
}
