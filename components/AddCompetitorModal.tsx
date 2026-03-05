'use client'
import { useState } from 'react'
import { CompetitorUrl } from '@/types'
import { formatMoney, normalizeCurrencyCode } from '@/lib/currency'

interface Props {
  productId: string
  productCurrency: string
  onClose: () => void
  onAdded: (competitor: CompetitorUrl) => void
  onUpdated: (competitor: CompetitorUrl) => void
}

export default function AddCompetitorModal({ productId, productCurrency, onClose, onAdded, onUpdated }: Props) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [checking, setChecking] = useState(false)
  const [scrapedPrice, setScrapedPrice] = useState<number | null>(null)
  const [confirmedPrice, setConfirmedPrice] = useState('')
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleCheckPrice = async () => {
    if (!url) return
    setChecking(true)
    setScrapeError(null)
    setScrapedPrice(null)
    setConfirmedPrice('')

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, targetCurrency: productCurrency }),
      })
      const data = await res.json()
      if (data.price) {
        setScrapedPrice(data.price)
        setConfirmedPrice(data.price.toFixed(2))
      } else {
        setScrapeError("Couldn't find a price on that page. Try a direct product URL.")
      }
    } catch {
      setScrapeError('Something went wrong. Check the URL and try again.')
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    if (!url) return
    setSaving(true)

    try {
      const initialPrice = confirmedPrice ? parseFloat(confirmedPrice) : null
      const res = await fetch('/api/competitors/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, url, label, initialPrice: Number.isFinite(initialPrice) ? initialPrice : null }),
      })
      const data = await res.json()
      if (data.competitor) {
        onAdded(data.competitor)
        onClose()

        fetch('/api/competitors/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ competitorId: data.competitor.id }),
        })
          .then(async fetchRes => {
            if (!fetchRes.ok) return null
            const fetchData = await fetchRes.json()
            if (fetchData.competitor) {
              onUpdated(fetchData.competitor)
            }
            return null
          })
          .catch(() => {})
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <h2 className="font-extrabold text-lg">Add Competitor URL</h2>
          <p className="text-sm text-gray-500 mt-1">Confirm fetched price before you start watching.</p>
        </div>

        <div className="px-7 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Competitor URL *</label>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); setScrapedPrice(null); setConfirmedPrice(''); setScrapeError(null) }}
                placeholder="https://competitor.com/products/widget"
                className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
              />
              <button
                onClick={handleCheckPrice}
                disabled={!url || checking}
                className="bg-gray-100 text-gray-700 font-semibold text-sm px-4 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {checking ? '...' : '🔍 Check'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Description (optional)</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Amazon, Best Buy"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>

          {checking && <div className="bg-gray-50 rounded-xl p-3.5 text-sm text-gray-500 text-center animate-pulse">Fetching price from page...</div>}
          {scrapeError && <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-600">{scrapeError}</div>}

          {scrapedPrice !== null && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-green-700">✓ Price found</span>
                <span className="text-lg font-extrabold text-gray-900">{formatMoney(scrapedPrice, normalizeCurrencyCode(productCurrency))}</span>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Confirm price</label>
                <input
                  type="number"
                  value={confirmedPrice}
                  onChange={e => setConfirmedPrice(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-7 pb-7 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!url || saving}
            className="flex-2 flex-1 bg-black text-white font-bold text-sm py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Start Watching'}
          </button>
        </div>
      </div>
    </div>
  )
}
