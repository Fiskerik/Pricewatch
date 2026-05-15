export type Plan = 'free' | 'pro' | 'business'

export interface Store {
  id: string
  user_id: string
  shop_domain: string | null
  plan: Plan
  shopify_charge_id: string | null
  created_at: string
}

export interface Product {
  id: string
  store_id: string
  shopify_product_id: string | null
  title: string
  handle: string | null
  image_url: string | null
  our_price: number | null
  vat_included?: boolean | null
  currency_code?: string | null
  created_at: string
  competitor_urls?: CompetitorUrl[]
  map_floor_price?: number | null
  map_enabled?: boolean | null
  auto_price_enabled?: boolean | null
  auto_price_undercut_type?: 'percent' | 'fixed' | null
  auto_price_undercut_value?: number | null
  auto_price_suggested?: number | null
  auto_price_suggested_at?: string | null
}

export interface CompetitorUrl {
  id: string
  product_id: string
  url: string
  price_decimal_shift?: number | null      
  price_currency_override?: string | null  
  label: string | null
  last_price: number | null
  vat_included?: boolean | null
  selected_price_metric?: string | null
  last_price_currency?: string | null
  last_checked_at: string | null
  last_changed_at: string | null
  last_stock_status?: 'in_stock' | 'out_of_stock' | 'unknown' | null
  last_stock_changed_at?: string | null
  match_confidence?: number | null
  mismatch_reasons?: string[] | null
  preflight_signals?: {
    title?: string | null
    brand?: string | null
    variant?: string | null
    size?: string | null
    source?: string[]
  } | null
  is_active: boolean
  created_at: string
  price_history?: PriceHistory[]
}

export interface PriceHistory {
  id: string
  competitor_url_id: string
  price: number
  checked_at: string
}

export const PLAN_LIMITS: Record<Plan, { products: number; competitors: number; checkFrequency: 'hourly' | 'daily' }> = {
  free:     { products: 5,        competitors: 2,   checkFrequency: 'daily' },
  pro:      { products: 25,        competitors: 5,  checkFrequency: 'daily' },  
  business: { products: Infinity,  competitors: Infinity, checkFrequency: 'hourly' }, 
}
