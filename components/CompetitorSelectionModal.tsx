'use client'
import { useState, useEffect } from 'react'
import { formatMoney, normalizeCurrencyCode } from '@/lib/currency'
 
interface DiscoveredCompetitor {
  url: string
  label: string
  price: number | null
  currency: string | null
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown'
  confidence: number
  domain: string
}
 
interface Props {
  productId: string
  productTitle: string
  productCurrency: string
  initialCandidates?: DiscoveredCompetitor[]
  onClose: () => void
  onCompetitorsAdded: (count: number) => void
}
 
export default function CompetitorSelectionModal({ 
  productId, 
  productTitle, 
  productCurrency,
  initialCandidates,
  onClose, 
  onCompetitorsAdded 
}: Props) {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<DiscoveredCompetitor[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
 
  useEffect(() => {
    const hasInitialCandidates = Array.isArray(initialCandidates)
 
    if (hasInitialCandidates) {
      setCandidates(initialCandidates)
      setError(initialCandidates.length === 0
        ? 'No competitors found. Try refining your product title or add competitors manually.'
        : null)
      setLoading(false)
      return
    }
 
    const loadCandidates = async () => {
      setLoading(true)
      setError(null)
 
      try {
        const res = await fetch('/api/competitors/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            title: productTitle,
            currency: productCurrency,
            limit: 10
          }),
        })
 
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data?.error || 'Failed to discover competitors')
        }
 
        const data = await res.json()
        const discoveredCandidates = Array.isArray(data?.candidates) ? data.candidates : []
 
        setCandidates(discoveredCandidates)
 
        if (discoveredCandidates.length === 0) {
          setError('No competitors found. Try refining your product title or add competitors manually.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load competitors')
      } finally {
        setLoading(false)
      }
    }
 
    loadCandidates()
  }, [productId, productTitle, productCurrency, initialCandidates])
 
  const handleToggle = (url: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
      }
      return next
    })
  }
 
  const handleSelectAll = () => {
    if (selected.size === candidates.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map(c => c.url)))
    }
  }
 
  const handleAddSelected = async () => {
    if (selected.size === 0) return
    
    setAdding(true)
    setError(null)
    
    let addedCount = 0
    const selectedCandidates = candidates.filter(c => selected.has(c.url))
    
    for (const candidate of selectedCandidates) {
      try {
        const res = await fetch('/api/competitors/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            url: candidate.url,
            label: candidate.label || null,
            initialPrice: candidate.price,
            initialCurrency: candidate.currency,
          }),
        })
 
        if (res.ok) {
          addedCount++
        }
      } catch (err) {
        console.error('Failed to add competitor:', candidate.url, err)
      }
    }
    
    setAdding(false)
    onCompetitorsAdded(addedCount)
    onClose()
  }
 
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="font-extrabold text-lg mb-1">Select Competitors to Track</h2>
              <p className="text-sm text-gray-500 truncate">
                Searching for: <span className="font-semibold">{productTitle}</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Click any row to visit the competitor page in a new tab
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-900 transition-colors text-2xl leading-none shrink-0"
            >
              ×
            </button>
          </div>
        </div>
 
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mb-3"></div>
                <div className="text-sm text-gray-500">Searching Google Shopping for competitors...</div>
              </div>
            </div>
          )}
 
          {error && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
              {error}
            </div>
          )}
 
          {!loading && !error && candidates.length > 0 && (
            <>
              {/* Select All */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div className="text-sm text-gray-600">
                  {selected.size} of {candidates.length} selected
                </div>
                <button
                  onClick={handleSelectAll}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  {selected.size === candidates.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
 
              {/* Table of competitors */}
              <div className="space-y-2">
                {candidates.map((candidate) => {
                  const isSelected = selected.has(candidate.url)
                  const currency = normalizeCurrencyCode(candidate.currency || productCurrency)
                  
                  return (
                    <div
                      key={candidate.url}
                      className={`rounded-xl border-2 transition-all ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      {/* Clickable row to visit link */}
                      <a
                        href={candidate.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-4 p-4 hover:bg-gray-50/50 transition-colors rounded-t-xl"
                        onClick={(e) => {
                          // Don't navigate if clicking the checkbox area
                          const target = e.target as HTMLElement
                          if (target.closest('button')) {
                            e.preventDefault()
                          }
                        }}
                      >
                        {/* Checkbox */}
                        <div className="shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleToggle(candidate.url)
                            }}
                            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600'
                                : 'bg-white border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            {isSelected && (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </div>
 
                        {/* Store info */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-1 truncate">
                            {candidate.domain}
                          </div>
                          <div className="font-semibold text-sm leading-tight line-clamp-2">
                            {candidate.label}
                          </div>
                        </div>
 
                        {/* Price and stock */}
                        <div className="shrink-0 text-right">
                          {candidate.price !== null ? (
                            <div className="text-lg font-extrabold text-gray-900">
                              {formatMoney(candidate.price, currency)}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-400">
                              Price not found
                            </div>
                          )}
                          
                          {/* Stock status */}
                          <div className="mt-1">
                            {candidate.stockStatus === 'in_stock' ? (
                              <span className="inline-flex items-center rounded-md bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                In stock
                              </span>
                            ) : candidate.stockStatus === 'out_of_stock' ? (
                              <span className="inline-flex items-center rounded-md bg-red-100 border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                Out of stock
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                                N/A
                              </span>
                            )}
                          </div>
                        </div>
 
                        {/* External link icon */}
                        <div className="shrink-0 text-gray-400">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </div>
                      </a>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
 
        {/* Footer */}
        {!loading && candidates.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 text-gray-600 font-semibold text-sm rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddSelected}
              disabled={selected.size === 0 || adding}
              className="px-6 py-2.5 bg-black text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {adding 
                ? 'Adding...' 
                : `Add ${selected.size} ${selected.size === 1 ? 'Competitor' : 'Competitors'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
 
