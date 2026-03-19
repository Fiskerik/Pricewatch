import type { Metadata, ResolvingMetadata } from 'next'

export const siteConfig = {
  name: 'Pricingspy',
  shortName: 'Pricingspy',
  description:
    'Competitor price tracking for Shopify stores with automated monitoring, price alerts, and faster repricing decisions.',
  url: 'https://www.pricingspy.app',
  locale: 'en_US',
  keywords: [
    'competitor price tracking',
    'Shopify price monitoring',
    'price change alerts',
    'competitor monitoring tool',
    'Shopify competitor tracking',
    'price intelligence for Shopify',
    'ecommerce price tracking',
    'Shopify repricing',
  ],
} as const

export const defaultOgImage = '/logo.png'

export function absoluteUrl(path = '/') {
  return new URL(path, siteConfig.url).toString()
}

export function buildPageMetadata({
  title,
  description,
  path = '/',
  keywords = [],
  index = true,
}: {
  title: string
  description: string
  path?: string
  keywords?: string[]
  index?: boolean
}): Metadata {
  const url = absoluteUrl(path)

  return {
    title,
    description,
    keywords: [...siteConfig.keywords, ...keywords],
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      images: [
        {
          url: absoluteUrl(defaultOgImage),
          width: 512,
          height: 512,
          alt: `${siteConfig.name} logo`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [absoluteUrl(defaultOgImage)],
    },
    robots: index
      ? {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
          },
        }
      : {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        },
  }
}

export async function mergePageTitle(
  metadata: ResolvingMetadata,
  title: string,
): Promise<string> {
  const parent = await metadata
  const parentTitle = parent.title && 'absolute' in parent.title ? parent.title.absolute : undefined

  return parentTitle ? `${title} | ${parentTitle}` : title
}
