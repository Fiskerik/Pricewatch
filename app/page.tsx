import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* Nav */}
      <nav className="flex justify-between items-center px-8 py-5 border-b border-gray-100 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-black rounded-md flex items-center justify-center text-white text-sm font-bold">⚡</div>
          <span className="font-bold text-base">PriceWatch</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#pricing" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Pricing</a>
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Log in</Link>
          <Link href="/signup" className="bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto text-center px-6 pt-24 pb-20">
        <div className="inline-block bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-full mb-8 tracking-wide">
          BUILT FOR SHOPIFY SELLERS
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.08] tracking-tight mb-6">
          Stop checking competitor<br />prices manually
        </h1>
        <p className="text-xl text-gray-500 leading-relaxed mb-10 max-w-xl mx-auto">
          Paste a competitor URL. We watch it. You get an email the moment their price changes.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/signup" className="bg-black text-white font-bold px-7 py-3.5 rounded-xl text-base hover:bg-gray-800 transition-colors">
            Start free — no card needed
          </Link>
          <a href="#how" className="bg-white border-2 border-gray-200 text-gray-700 font-semibold px-7 py-3.5 rounded-xl text-base hover:border-gray-400 transition-colors">
            See how it works
          </a>
        </div>
        <p className="text-sm text-gray-400 mt-6">Enterprise tools charge $200+/mo for this. We charge $15.</p>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-5xl mx-auto px-6 py-20 border-t border-gray-100">
        <h2 className="text-3xl font-extrabold text-center mb-14 tracking-tight">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { step: '1', title: 'Connect your store', desc: 'Link your Shopify store with one click. We sync all your products automatically.' },
            { step: '2', title: 'Add competitor URLs', desc: 'On any product, paste a competitor\'s product URL. We find and save their current price.' },
            { step: '3', title: 'Get alerts instantly', desc: 'We check prices hourly. The moment something changes, you get a clean email alert.' },
          ].map(item => (
            <div key={item.step} className="text-center">
              <div className="w-10 h-10 bg-black text-white rounded-xl font-bold text-lg mx-auto mb-5 flex items-center justify-center">{item.step}</div>
              <h3 className="font-bold text-lg mb-2">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20 border-t border-gray-100">
        <h2 className="text-3xl font-extrabold text-center mb-3 tracking-tight">Simple pricing</h2>
        <p className="text-gray-500 text-center mb-12">No contracts. Cancel anytime.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              name: 'Free', price: '$0', period: 'forever',
              features: ['3 products', '2 competitors each', 'Daily price checks', 'Email alerts'],
              cta: 'Get started', href: '/signup', highlight: false,
            },
            {
              name: 'Pro', price: '$15', period: 'per month',
              features: ['50 products', '10 competitors each', 'Hourly price checks', 'Email alerts', 'Price history charts'],
              cta: 'Start Pro free trial', href: '/signup?plan=pro', highlight: true,
            },
            {
              name: 'Business', price: '$39', period: 'per month',
              features: ['Unlimited products', 'Unlimited competitors', 'Hourly price checks', 'Email + Slack alerts', 'Price history charts'],
              cta: 'Start Business trial', href: '/signup?plan=business', highlight: false,
            },
          ].map(plan => (
            <div key={plan.name} className={`rounded-2xl p-7 border-2 flex flex-col ${plan.highlight ? 'bg-black text-white border-black' : 'border-gray-200'}`}>
              <div className="font-bold text-base mb-1">{plan.name}</div>
              <div className="text-4xl font-extrabold mb-1">{plan.price}</div>
              <div className={`text-sm mb-6 ${plan.highlight ? 'text-gray-400' : 'text-gray-400'}`}>{plan.period}</div>
              <ul className="flex-1 space-y-3 mb-8">
                {plan.features.map(f => (
                  <li key={f} className="text-sm flex items-center gap-2">
                    <span className={plan.highlight ? 'text-green-400' : 'text-green-500'}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href={plan.href} className={`w-full text-center font-bold py-3 rounded-xl text-sm transition-colors ${plan.highlight ? 'bg-white text-black hover:bg-gray-100' : 'bg-black text-white hover:bg-gray-800'}`}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} PriceWatch · Built for Shopify sellers
      </footer>
    </div>
  )
}
