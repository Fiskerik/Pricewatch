'use client'
import { useState } from 'react'
import { Product } from '@/types'

interface Props {
  storeId: string
  onClose: () => void
  onAdded: (product: Product) => void
}

export default function AddProductModal({ storeId, onClose, onAdded }: Props) {
  const [title, setTitle] = useState('')
  const [ourPrice, setOurPrice] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !storeId) return
    setSaving(true)

    const res = await fetch('/api/products/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, title, ourPrice: ourPrice ? parseFloat(ourPrice) : null }),
    })
    const data = await res.json()
    if (data.product) onAdded(data.product)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <h2 className="font-extrabold text-lg">Add Product</h2>
          <p className="text-sm text-gray-500 mt-1">Add manually or connect Shopify to sync automatically.</p>
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
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">Your Price (optional)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={ourPrice}
                onChange={e => setOurPrice(e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-200 rounded-lg pl-7 pr-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title} className="flex-1 bg-black text-white font-bold text-sm py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40">
              {saving ? 'Adding...' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
