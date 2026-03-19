import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo'
import UninstallFeedbackForm from './UninstallFeedbackForm'

export const metadata: Metadata = buildPageMetadata({
  title: 'Uninstall feedback',
  description: 'Tell Pricingspy why you uninstalled the app and rate your experience.',
  path: '/uninstall-feedback',
  keywords: ['uninstall feedback', 'Shopify app feedback', 'Pricingspy uninstall'],
  index: false,
})

interface Props {
  searchParams?: {
    shop?: string
  }
}

export default function UninstallFeedbackPage({ searchParams }: Props) {
  const shop = typeof searchParams?.shop === 'string' ? searchParams.shop.trim().toLowerCase() : ''
  const isValidShop = /^[a-z0-9-]+\.myshopify\.com$/.test(shop)

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {isValidShop ? (
          <UninstallFeedbackForm shop={shop} />
        ) : (
          <section className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">Uninstall feedback</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">We could not identify the Shopify store</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Please reopen this page from the uninstall flow so we can attach your feedback to the correct store.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
            >
              Back to homepage
            </Link>
          </section>
        )}
      </div>
    </main>
  )
}
