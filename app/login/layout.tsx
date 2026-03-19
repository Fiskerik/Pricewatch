import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Log In',
  description: 'Log in to your Pricingspy account to monitor competitor prices, review alerts, and manage your Shopify pricing workflows.',
  path: '/login',
  keywords: ['Pricingspy login', 'Shopify competitor tracker login'],
  index: false,
})

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
