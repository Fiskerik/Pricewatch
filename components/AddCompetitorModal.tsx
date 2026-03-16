'use client'
import { useEffect, useState } from 'react'
import { CompetitorUrl } from '@/types'

interface Props {
  productId: string
  productCurrency: string
  onClose: () => void
  onAdded: (competitor: CompetitorUrl) => void
  onUpdated: (competitor: CompetitorUrl) => void
  mode?: 'add' | 'edit'
  competitor?: CompetitorUrl | null
  onDeleted?: (competitorId: string) => void
}

interface DebugCandidate {
  metric: string
  source: string
  currency: string
  price: number
  confidence?: number
}

// ── Client-side URL sanitizer ────────────────────────────────────────────────
// Mirrors the server-side normalizer. Runs before the API call so users
// get instant feedback instead of a 400 error after a round-trip.
function sanitizeUrl(rawInput: string): { url: string; error: string | null } {
  try {
    let input = rawInput.trim()

    // Strip surrounding quotes/backticks
    input = input.replace(/^["'`]+|["'`]+$/g, '').trim()

    // Decode HTML entities
    input = input
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')

    // Extract embedded URL from mixed text
    if (input.includes(' ')) {
      const embedded = input.match(/https?:\/\/[^\s"'<>()[\]{}\\]+/i)
      if (embedded) {
        input = embedded[0]
      } else {
        input = input.replace(/\s+/g, '%20')
      }
    }

    // Protocol-relative → https
    if (input.startsWith('//')) input = 'https:' + input

    // Auto-add https:// if missing
    if (!/^https?:\/\//i.test(input)) {
      if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(input)) {
        input = 'https://' + input
      } else {
        return { url: '', error: 'Please paste a full product page URL (e.g. https://example.com/product)' }
      }
    }

    const parsed = new URL(input)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: '', error: 'Only http:// and https:// URLs are supported' }
    }

    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return { url: '', error: 'URL does not look like a valid website address' }
    }

    return { url: input, error: null }
  } catch {
    return { url: '', error: 'Please paste a full product page URL (e.g. https://example.com/product)' }
  }
}

export default function AddCompetitorModal({
  productId,
  productCurrency,
  onClose,
  onAdded,
  onUpdated,
  mode = 'add',
  competitor,
  onDeleted,
}: Props) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [trackingMetric, setTrackingMetric] = useState<string | null>(null)
  const [lockTrackingMetric, setLockTrackingMetric] = useState(true)
  const [testingScrape, setTestingScrape] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugData, setDebugData] = useState<{
    metricUsed: string | null
    matchedPreferredMetric: boolean
    candidates: DebugCandidate[]
  } | null>(null)

  useEffect(() => {
    if (mode === 'edit' && competitor) {
      setUrl(competitor.url)
      setLabel(competitor.label ?? '')
    } else {
      setUrl('')
      setLabel('')
    }
    setSaveError(null)
    setTrackingMetric(competitor?.selected_price_metric ?? null)
    setLockTrackingMetric(true)
    setDebugOpen(false)
    setDebugData(null)
  }, [mode, competitor])

  // Validate URL on blur so the user gets feedback as soon as they leave the field
  const handleUrlBlur = () => {
    if (!url.trim()) return
    const { error } = sanitizeUrl(url)
    if (error) setSaveError(error)
  }

  const handleTestScrapeNow = async () => {
    if (!competitor?.id) return
    setTestingScrape(true)
    setDebugOpen(true)
    setSaveError(null)

    try {
      const res = await fetch('/api/competitors/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId: competitor.id, preferredMetric: trackingMetric }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data?.error || 'Failed to test scrape.')
        return
      }

      const candidates = Array.isArray(data?.candidates) ? data.candidates as DebugCandidate[] : []
      setDebugData({
        metricUsed: typeof data?.metricUsed === 'string' ? data.metricUsed : null,
        matchedPreferredMetric: Boolean(data?.matchedPreferredMetric),
        candidates,
      })

      if ((!trackingMetric || !trackingMetric.trim()) && candidates.length > 0) {
        setTrackingMetric(candidates[0].metric)
      }
    } catch {
      setSaveError('Failed to test scrape.')
    } finally {
      setTestingScrape(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    // Client-side validation before sending to the API
    if (mode === 'add') {
      const { error: urlError } = sanitizeUrl(url)
      if (urlError) {
        setSaveError(urlError)
        return
      }
    }

    setSaving(true)
    setSaveError(null)

    try {
      if (mode === 'edit' && competitor) {
        const res = await fetch('/api/competitors/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            competitorId: competitor.id,
            url: url.trim(),
            label: label.trim() || null,
            selectedMetric: lockTrackingMetric ? trackingMetric : null,
          }),
        })
        const data = await res.json()
        if (!res.ok) { setSaveError(data?.error || 'Could not save changes.'); return }
        if (data.competitor) { onUpdated(data.competitor); onClose() }
        return
      }

      const res = await fetch('/api/competitors/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          url: url.trim(),
          label: label.trim() || null,
          initialPrice: null,
          initialCurrency: null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data?.error || 'Could not add competitor.')
        return
      }
      if (data.competitor) {
        onAdded(data.competitor)
        onClose()
      }
    } catch {
      setSaveError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!competitor) return
    setDeleting(true)
    try {
      const res = await fetch('/api/competitors/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorId: competitor.id }),
      })
      if (res.ok) { onDeleted?.(competitor.id); onClose() }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <h2 className="font-extrabold text-lg">
            {mode === 'edit' ? 'Edit Competitor' : 'Add Competitor URL'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'edit'
              ? 'Update the saved competitor details.'
              : `Paste the competitor's product page URL. Tracking parameters are stripped automatically.`}
          </p>
        </div>

        <form onSubmit={handleSave} className="px-7 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Competitor URL *
            </label>
            <input
              required
              value={url}
              onChange={e => { setUrl(e.target.value); setSaveError(null) }}
              onBlur={handleUrlBlur}
              placeholder="https://competitor.com/products/widget"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Paste any product page link — tracking params like <code className="bg-gray-100 px-1 rounded">utm_source</code>, <code className="bg-gray-100 px-1 rounded">msclkid</code>, etc. are stripped automatically.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Label (optional)
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Amazon, Netonnet, H&M"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>

          {mode === 'edit' && competitor && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Tracking metric</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Select once and lock for future checks.</div>
                </div>
                <button
                  type="button"
                  onClick={handleTestScrapeNow}
                  disabled={testingScrape}
                  className="text-xs font-semibold border border-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-40"
                >
                  {testingScrape ? 'Testing…' : 'Test scrape now'}
                </button>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lockTrackingMetric}
                  onChange={(e) => setLockTrackingMetric(e.target.checked)}
                />
                Lock selected metric for future checks
              </label>

              <input
                value={trackingMetric ?? ''}
                onChange={(e) => setTrackingMetric(e.target.value || null)}
                placeholder="e.g. product.variants[0].price"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-black transition-colors"
              />

              {debugOpen && (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs space-y-2">
                  <div className="font-semibold text-gray-700">Debug panel</div>
                  {!debugData && <div className="text-gray-500">Run test scrape to inspect extraction candidates.</div>}
                  {debugData && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 border font-semibold ${debugData.matchedPreferredMetric ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                          {debugData.matchedPreferredMetric ? 'matched' : 'fallback'}
                        </span>
                        {!debugData.matchedPreferredMetric && (
                          <span className="text-[11px] text-amber-700">Preferred metric missed, scraper used fallback.</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {debugData.candidates.length === 0 && (
                          <div className="text-gray-500">
                            No candidates found. Try a different URL or adjust the metric manually.
                          </div>
                        )}
                        {debugData.candidates.slice(0, 5).map((candidate, idx) => {
                          const checked = trackingMetric === candidate.metric
                          return (
                            <label
                              key={`${candidate.metric}-${idx}`}
                              className="flex items-start justify-between gap-2 rounded-md border border-gray-200 px-2 py-1.5 cursor-pointer"
                            >
                              <span className="inline-flex items-start gap-2">
                                <input
                                  type="radio"
                                  name="debug-metric"
                                  checked={checked}
                                  onChange={() => setTrackingMetric(candidate.metric)}
                                  className="mt-0.5"
                                />
                                <span>
                                  <div className="font-medium text-gray-800">#{idx + 1} {candidate.metric}</div>
                                  <div className="text-gray-600">price: {candidate.price}</div>
                                  <div className="text-gray-600">source: {candidate.source}</div>
                                  <div className="text-gray-600">detected currency: {candidate.currency}</div>
                                </span>
                              </span>
                              {debugData.metricUsed === candidate.metric && (
                                <span className="text-[10px] font-semibold text-green-700">used</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              {saveError}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            {mode === 'edit' && competitor && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="border border-red-200 text-red-600 font-semibold text-sm py-2.5 px-4 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim() || saving || deleting}
              className="flex-1 bg-black text-white font-bold text-sm py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Start Watching'}
            </button>
          </div>

          <p className="text-[11px] text-gray-500 pt-1">
            Having trouble? Email support: eaconsulting.supp@gmail.com
          </p>
        </form>
      </div>
    </div>
  )
}
