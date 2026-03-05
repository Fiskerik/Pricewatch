'use client'
import { useState } from 'react'
import { Product } from '@/types'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'

interface Props {
  storeId: string
  onClose: () => void
  onAdded: (product: Product) => void
  onUpdated?: (product: Product) => void
  mode?: 'add' | 'edit'
  product?: Product | null
}

export default function AddProductModal({ storeId, onClose, onAdded, onUpdated, mode = 'add', product }: Props) {
  const [title, setTitle] = useState(product?.title ?? '')
  const [ourPrice, setOurPrice] = useState(product?.our_price !== null && product?.our_price !== undefined ? String(product.our_price) : '')
  const [currencyCode, setCurrencyCode] = useState(product?.currency_code ?? 'USD')
  const [saving, setSaving] = useState(false)

  const isEditMode = mode === 'edit' && !!product

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !storeId) return
    setSaving(true)

    try {
      const endpoint = isEditMode ? '/api/products/update' : '/api/products/add'
      const method = isEditMode ? 'PATCH' : 'POST'
      const payload = isEditMode
        ? { productId: product.id, title, currencyCode, ourPrice: ourPrice ? parseFloat(ourPrice) : null }
        : { storeId, title, currencyCode, ourPrice: ourPrice ? parseFloat(ourPrice) : null }

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.product) {
        if (isEditMode) {
          onUpdated?.(data.product)
        } else {
          onAdded(data.product)
        }
      }
      setSaving(false)
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <h2 className="font-extrabold text-lg">{isEditMode ? 'Edit Product' : 'Add Product'}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isEditMode ? 'Update your product listing details.' : 'Add manually or connect Shopify to sync automatically.'}
          </p>
        </div>

        <form onSubmit={handleSave} className="px-7 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Product Name *</label>
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Wireless Headphones Model X"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Main Currency</label>
            <select
              value={currencyCode}
              onChange={e => setCurrencyCode(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            >
              {SUPPORTED_CURRENCIES.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Your Price (optional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={ourPrice}
              onChange={e => setOurPrice(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title} className="flex-1 bg-black text-white font-bold text-sm py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40">
              {saving ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Product')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
