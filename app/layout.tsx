import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { absoluteUrl, siteConfig } from '@/lib/seo'

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: 'Pricingspy | Competitor Price Tracking for Shopify Stores',
    template: '%s | Pricingspy',
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  category: 'ecommerce software',
  keywords: [...siteConfig.keywords],
  alternates: {
    canonical: absoluteUrl('/'),
  },
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    type: 'website',
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: 'Pricingspy | Competitor Price Tracking for Shopify Stores',
    description: siteConfig.description,
    locale: siteConfig.locale,
    images: [
      {
        url: absoluteUrl('/logo.png'),
        width: 512,
        height: 512,
        alt: 'Pricingspy logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricingspy | Competitor Price Tracking for Shopify Stores',
    description: siteConfig.description,
    images: [absoluteUrl('/logo.png')],
  },
  verification: {
    google: 'a7ooX99wNHGQkLtrXE6yZp6A_dw1L1lpWOvVXN-DUgI',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-6N7M7HP05T"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-6N7M7HP05T');
        `}</Script>
      </head>
      <body>{children}</body>
    </html>
  )
}
