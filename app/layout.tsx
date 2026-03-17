import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pricingspy — Competitor Price Tracking for Shopify',
  description: 'Paste a competitor URL. We watch it. You get an alert when prices change. Starting free.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  verification: {
    google: 'a7ooX99wNHGQkLtrXE6yZp6A_dw1L1lpWOvVXN-DUgI',
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
