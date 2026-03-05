import Link from 'next/link'

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
              PriceWatch collects account details (such as your name and email), Shopify store connection data,
              and product or competitor URLs you add to the platform to provide price monitoring services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. How We Use Information</h2>
            <p>
              We use your information to operate the service, run price checks, deliver alerts, process billing,
              and improve the reliability and performance of PriceWatch.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share limited data with trusted service providers
              (for example, payment processing, infrastructure, and email delivery) strictly to run PriceWatch.
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
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Your Rights</h2>
            <p>
              Depending on your location, you may have rights to access, correct, or delete your personal
              information. Contact us to submit a request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Contact</h2>
            <p>
              For privacy-related questions, contact us at{' '}
              <a className="text-black underline" href="mailto:support@pricewatch.app">
                support@pricewatch.app
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
