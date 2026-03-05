'use client'
import Image from 'next/image'
import { Product } from '@/types'

interface Props {
  product: Product
  isExpanded: boolean
  onToggle: () => void
  onAddCompetitor: () => void
  competitorLimit: number
}

export default function ProductCard({ product, isExpanded, onToggle, onAddCompetitor, competitorLimit }: Props) {
  const competitors = product.competitor_urls ?? []
  const hasChanges = competitors.some(c => {
    if (!c.last_changed_at) return false
    return new Date(c.last_changed_at) > new Date(Date.now() - 86400000)
  })
  const atLimit = competitorLimit !== Infinity && competitors.length >= competitorLimit

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Product row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Image */}
        <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">
          {product.image_url ? (
            <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📦</div>
          )}
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{product.title}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {product.our_price ? `Your price: $${product.our_price.toFixed(2)} · ` : ''}
            {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} tracked
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 shrink-0">
          {hasChanges && (
            <span className="bg-red-50 text-red-600 text-xs font-semibold px-2.5 py-1 rounded-full">
              Price changed!
            </span>
          )}
          <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded: competitor list */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-5 pb-4 pt-3 space-y-2">
          {competitors.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No competitors added yet.</p>
          )}

          {competitors.map(comp => {
            const changed = comp.last_changed_at && new Date(comp.last_changed_at) > new Date(Date.now() - 86400000)
            const cheaper = comp.last_price !== null && product.our_price !== null && comp.last_price < product.our_price

            return (
              <div
                key={comp.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                  changed ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{comp.label || new URL(comp.url).hostname}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Checked {comp.last_checked_at ? new Date(comp.last_checked_at).toLocaleString() : 'never'}
                  </div>
                </div>

                {comp.last_price !== null ? (
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-extrabold ${cheaper ? 'text-red-500' : 'text-green-600'}`}>
                      ${comp.last_price.toFixed(2)}
                    </div>
                    <div className={`text-xs font-semibold ${cheaper ? 'text-red-400' : 'text-green-500'}`}>
                      {cheaper ? 'CHEAPER' : 'HIGHER'}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Pending</span>
                )}
              </div>
            )
          })}

          {/* Add competitor button */}
          <button
            onClick={onAddCompetitor}
            disabled={atLimit}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {atLimit ? `Competitor limit reached (${competitorLimit})` : '+ Add competitor URL'}
          </button>
        </div>
      )}
    </div>
  )
}
