'use client'

import { FormEvent, useMemo, useState } from 'react'

const UNINSTALL_REASONS = [
  { value: 'too_expensive', label: 'The app is too expensive' },
  { value: 'missing_features', label: 'It is missing features I need' },
  { value: 'hard_to_use', label: 'It was hard to set up or use' },
  { value: 'not_accurate_enough', label: 'The tracking results were not accurate enough' },
  { value: 'technical_issues', label: 'I ran into bugs or technical issues' },
  { value: 'switching_tools', label: 'I am switching to another tool' },
  { value: 'temporary_need_only', label: 'I only needed it temporarily' },
  { value: 'no_longer_using_shopify', label: 'I am no longer selling on Shopify' },
  { value: 'other', label: 'Other' },
] as const

const STAR_OPTIONS = [1, 2, 3, 4, 5] as const
const MIN_DETAILS_LENGTH = 20

interface Props {
  shop: string
}

export default function UninstallFeedbackForm({ shop }: Props) {
  const [reasonCode, setReasonCode] = useState('')
  const [details, setDetails] = useState('')
  const [email, setEmail] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const detailsEnabled = Boolean(reasonCode)
  const remainingCharacters = useMemo(() => Math.max(0, MIN_DETAILS_LENGTH - details.trim().length), [details])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!reasonCode) {
      setMessage({ type: 'error', text: 'Please select a reason for uninstalling.' })
      return
    }

    if (details.trim().length < MIN_DETAILS_LENGTH) {
      setMessage({ type: 'error', text: `Please share at least ${MIN_DETAILS_LENGTH} characters of detail.` })
      return
    }

    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Please enter your email before submitting.' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      const res = await fetch('/api/uninstall-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop,
          email: email.trim(),
          reasonCode,
          details: details.trim(),
          rating,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessage({ type: 'error', text: data?.error || 'Could not submit your feedback.' })
        return
      }

      setMessage({ type: 'success', text: 'Thanks for the feedback — it has been saved.' })
      setReasonCode('')
      setDetails('')
      setEmail('')
      setRating(null)
    } catch {
      setMessage({ type: 'error', text: 'Could not submit your feedback. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">Uninstall feedback</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">Help us understand why you removed Pricingspy</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your feedback helps us improve the product for Shopify merchants. Store: <span className="font-semibold text-gray-900">{shop}</span>
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900">What was the main reason?</legend>
        <div className="space-y-3">
          {UNINSTALL_REASONS.map((reason) => {
            const checked = reasonCode === reason.value
            return (
              <label
                key={reason.value}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${checked ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <input
                  type="radio"
                  name="reasonCode"
                  value={reason.value}
                  checked={checked}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="mt-1 h-4 w-4 border-gray-300 text-black focus:ring-black"
                />
                <span className="text-sm font-medium text-gray-700">{reason.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="space-y-3">
        <label htmlFor="details" className="text-sm font-semibold text-gray-900">
          Tell us more
        </label>
        <textarea
          id="details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          disabled={!detailsEnabled}
          minLength={MIN_DETAILS_LENGTH}
          placeholder={detailsEnabled ? 'Please share enough detail so we can act on it.' : 'Select a reason first to unlock this field.'}
          className="min-h-32 w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{detailsEnabled ? 'At least 20 characters required.' : 'Choose a reason to begin writing.'}</span>
          <span>{detailsEnabled ? `${remainingCharacters} characters left` : ''}</span>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-semibold text-gray-900">How would you rate your experience?</label>
        <div className="flex flex-wrap gap-3">
          {STAR_OPTIONS.map((value) => {
            const active = rating === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${active ? 'border-black bg-black text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
                aria-pressed={active}
              >
                <span>{'★'.repeat(value)}</span>
                <span>{value}</span>
              </button>
            )
          })}
          {rating !== null && (
            <button
              type="button"
              onClick={() => setRating(null)}
              className="inline-flex items-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300"
            >
              Clear rating
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <label htmlFor="email" className="text-sm font-semibold text-gray-900">
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          placeholder="name@company.com"
          className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-black"
        />
        <p className="text-xs text-gray-500">We only use this if we need to follow up on your feedback.</p>
      </div>

      {message && (
        <div className={`rounded-2xl px-4 py-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {submitting ? 'Submitting…' : 'Submit feedback'}
      </button>
    </form>
  )
}
