import { PLAN_LIMITS, Plan, Product } from '@/types'

type ProductWithCompetitors = Pick<Product, 'id' | 'competitor_urls'>

export interface PlanUsageStatus {
  plan: Plan
  productLimit: number
  competitorLimit: number
  productCount: number
  overProductLimit: boolean
  productsOverCompetitorLimit: number
  isPaused: boolean
}

export function getPlanUsageStatus(
  planInput: string | null | undefined,
  products: ProductWithCompetitors[],
): PlanUsageStatus {
  const plan = (planInput === 'pro' || planInput === 'business' ? planInput : 'free') as Plan
  const limits = PLAN_LIMITS[plan]
  const productCount = products.length
  const overProductLimit = limits.products !== Infinity && productCount > limits.products
  const productsOverCompetitorLimit = limits.competitors === Infinity
    ? 0
    : products.filter(product => (product.competitor_urls?.length ?? 0) > limits.competitors).length

  return {
    plan,
    productLimit: limits.products,
    competitorLimit: limits.competitors,
    productCount,
    overProductLimit,
    productsOverCompetitorLimit,
    isPaused: overProductLimit || productsOverCompetitorLimit > 0,
  }
}
