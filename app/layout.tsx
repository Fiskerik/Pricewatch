import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PriceWatch — Competitor Price Tracking for Shopify',
  description: 'Paste a competitor URL. We watch it. You get an alert when prices change. Starting free.',
  verification: {
    google: 'a7ooX99wNHGQkLtrXE6yZp6A_dw1L1lpWOvVXN-DUgI',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
