import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Sign Up',
  description: 'Create your Pricingspy account to start tracking competitor prices for your Shopify store with automated alerts and reporting.',
  path: '/signup',
  keywords: ['Pricingspy signup', 'Shopify competitor tracker signup'],
  index: false,
})

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
