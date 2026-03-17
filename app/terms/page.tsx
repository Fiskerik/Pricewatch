import Link from 'next/link'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to home
        </Link>

        <h1 className="text-4xl font-extrabold tracking-tight mt-6 mb-3">Terms and Conditions</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="space-y-8 text-sm leading-7 text-gray-700">
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Pricingspy, you agree to these Terms and Conditions. If you do not agree,
              you should not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. Use of Service</h2>
            <p>
              You are responsible for your account, connected store data, and the URLs you monitor. You agree to
              use the service only for lawful business purposes and in compliance with platform policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Billing and Subscriptions</h2>
            <p>
              Paid plans renew automatically unless canceled. Fees are billed in advance and are generally
              non-refundable unless required by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Availability</h2>
            <p>
              We aim to keep Pricingspy available and accurate, but we do not guarantee uninterrupted service or
              error-free data from third-party websites.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Pricingspy is not liable for indirect, incidental, or
              consequential damages resulting from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Termination</h2>
            <p>
              We may suspend or terminate access if these terms are violated. You may cancel your account at any
              time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Contact</h2>
            <p>
              For questions about these terms, contact{' '}
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
