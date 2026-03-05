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

  useEffect(() => {
    if (mode === 'edit' && competitor) {
      setUrl(competitor.url)
      setLabel(competitor.label ?? '')
    } else {
      setUrl('')
      setLabel('')
    }
    setSaveError(null)
  }, [mode, competitor])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
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
          }),
        })
        const data = await res.json()
        if (!res.ok) { setSaveError(data?.error || 'Could not save changes.'); return }
        if (data.competitor) { onUpdated(data.competitor); onClose() }
        return
      }

      // ADD mode — save immediately, price fetched in background by DashboardClient
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
        onAdded(data.competitor) // DashboardClient will trigger background fetch
        onClose()
      }
    } catch (err) {
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
              : 'Paste a URL — we\'ll fetch the price in the background.'}
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
              placeholder="https://competitor.com/products/widget"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Label (optional)
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Amazon, Best Buy, Dustin"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>

          {mode === 'add' && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center gap-2.5">
              <span className="text-blue-500 text-lg">⏱</span>
              <p className="text-xs text-blue-700 font-medium">
                We'll fetch the price automatically after you save. You can confirm or correct it from the dashboard.
              </p>
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
        </form>
      </div>
    </div>
  )
}
