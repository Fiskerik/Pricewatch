import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Privacy Policy',
  description: 'Read the Pricingspy privacy policy, including what data we collect, how we use it, and Shopify compliance webhook support.',
  path: '/privacy',
  keywords: ['Pricingspy privacy policy', 'Shopify app privacy policy'],
})

const complianceWebhookTopics = [
  {
    topic: 'customers/data_request',
    event: 'Requests to view stored customer data',
    endpoint: '/api/shopify/webhooks/compliance',
  },
  {
    topic: 'customers/redact',
    event: 'Requests to delete customer data',
    endpoint: '/api/shopify/webhooks/compliance',
  },
  {
    topic: 'shop/redact',
    event: 'Requests to delete shop data',
    endpoint: '/api/shopify/webhooks/compliance',
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to home
        </Link>

        <h1 className="text-4xl font-extrabold tracking-tight mt-6 mb-3">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="space-y-8 text-sm leading-7 text-gray-700">
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. Information We Collect</h2>
            <p>
              Pricingspy collects account details (such as your name and email), Shopify store connection data,
              and product or competitor URLs you add to the platform to provide price monitoring services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. How We Use Information</h2>
            <p>
              We use your information to operate the service, run price checks, deliver alerts, process billing,
              and improve the reliability and performance of Pricingspy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share limited data with trusted service providers
              (for example, payment processing, infrastructure, and email delivery) strictly to run Pricingspy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Data Retention</h2>
            <p>
              We keep your data while your account is active or as needed to provide the service. You may request
              deletion of your account and associated data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Security</h2>
            <p>
              We use reasonable technical and organizational safeguards to protect your information, but no system
              can be guaranteed 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Shopify Compliance Webhooks</h2>
            <p>
              Pricingspy supports Shopify&apos;s required privacy compliance webhooks for customer data access,
              customer redaction, and shop redaction requests. Shopify can send these requests to the following
              endpoints:
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Topic</th>
                    <th className="px-4 py-3 font-semibold">Event</th>
                    <th className="px-4 py-3 font-semibold">Endpoint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {complianceWebhookTopics.map((webhook) => (
                    <tr key={webhook.topic}>
                      <td className="px-4 py-3 align-top">
                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">{webhook.topic}</code>
                      </td>
                      <td className="px-4 py-3 align-top">{webhook.event}</td>
                      <td className="px-4 py-3 align-top">
                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">{webhook.endpoint}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              These webhook handlers verify Shopify signatures before processing requests and are used to support
              privacy and data deletion obligations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Your Rights</h2>
            <p>
              Depending on your location, you may have rights to access, correct, or delete your personal
              information. Contact us to submit a request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">8. Contact</h2>
            <p>
              For privacy-related questions, contact us at{' '}
              <a className="text-black underline" href="mailto:eaconsulting.supp@gmail.com">
                eaconsulting.supp@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
