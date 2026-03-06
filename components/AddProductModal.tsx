'use client'
import { useState, useEffect } from 'react'
import { Product } from '@/types'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

interface Store {
  id: string
  shop_domain: string | null
  store_name: string | null
}

interface ShopifyProduct {
  shopify_product_id: string
  title: string
  handle: string
  image_url: string | null
  price: number | null
}

interface Props {
  onClose: () => void
  onAdded: (product: Product) => void
  onUpdated?: (product: Product) => void
  mode?: 'add' | 'edit'
  product?: Product | null
}

export default function AddProductModal({ onClose, onAdded, onUpdated, mode = 'add', product }: Props) {
  const supabase = createClientComponentClient()
  const isEditMode = mode === 'edit' && !!product

  // Form state
  const [selectedStoreId, setSelectedStoreId] = useState(product?.store_id ?? '')
  const [inputMethod, setInputMethod] = useState<'manual' | 'shopify'>('manual')
  const [title, setTitle] = useState(product?.title ?? '')
  const [ourPrice, setOurPrice] = useState(product?.our_price !== null && product?.our_price !== undefined ? String(product.our_price) : '')
  const [currencyCode, setCurrencyCode] = useState(product?.currency_code ?? 'USD')
  
  // Data state
  const [stores, setStores] = useState<Store[]>([])
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([])
  const [selectedShopifyProduct, setSelectedShopifyProduct] = useState<string>('')
  const [loadingStores, setLoadingStores] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load user's stores
  useEffect(() => {
    const loadStores = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: allStores, error: storesError } = await supabase
          .from('stores')
          .select('id, shop_domain, store_name')
          .eq('user_id', user.id)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true })

        if (storesError) throw storesError

        setStores(allStores || [])
        
        // Auto-select first store if available and not in edit mode
        if (!isEditMode && allStores && allStores.length > 0) {
          setSelectedStoreId(allStores[0].id)
        }
      } catch (err) {
        console.error('Failed to load stores:', err)
        setError('Failed to load stores')
      } finally {
        setLoadingStores(false)
      }
    }

    loadStores()
  }, [])

  // Load Shopify products when store is selected and has shop_domain
  useEffect(() => {
    if (!selectedStoreId || inputMethod !== 'shopify') {
      setShopifyProducts([])
      return
    }

    const selectedStore = stores.find(s => s.id === selectedStoreId)
    if (!selectedStore?.shop_domain) {
      setShopifyProducts([])
      return
    }

    const loadShopifyProducts = async () => {
      setLoadingProducts(true)
      setError(null)
      
      try {
        const res = await fetch(`/api/shopify/products?storeId=${selectedStoreId}`)
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to load products')
        }

        const data = await res.json()
        setShopifyProducts(data.products || [])
      } catch (err) {
        console.error('Failed to load Shopify products:', err)
        setError(err instanceof Error ? err.message : 'Failed to load Shopify products')
        setShopifyProducts([])
      } finally {
        setLoadingProducts(false)
      }
    }

    loadShopifyProducts()
  }, [selectedStoreId, inputMethod, stores])

  // Auto-fill form when Shopify product is selected
  useEffect(() => {
    if (!selectedShopifyProduct) return

    const shopifyProduct = shopifyProducts.find(p => p.shopify_product_id === selectedShopifyProduct)
    if (shopifyProduct) {
      setTitle(shopifyProduct.title)
      if (shopifyProduct.price) {
        setOurPrice(String(shopifyProduct.price))
      }
    }
  }, [selectedShopifyProduct, shopifyProducts])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !selectedStoreId) return
    
    setSaving(true)
    setError(null)

    try {
      const endpoint = isEditMode ? '/api/products/update' : '/api/products/add'
      const method = isEditMode ? 'PATCH' : 'POST'
      
      const shopifyProduct = inputMethod === 'shopify' && selectedShopifyProduct
        ? shopifyProducts.find(p => p.shopify_product_id === selectedShopifyProduct)
        : null

      const payload = isEditMode
        ? { 
            productId: product.id, 
            title, 
            currencyCode, 
            ourPrice: ourPrice ? parseFloat(ourPrice) : null 
          }
        : { 
            storeId: selectedStoreId, 
            title, 
            currencyCode, 
            ourPrice: ourPrice ? parseFloat(ourPrice) : null,
            shopifyProductId: shopifyProduct?.shopify_product_id ?? null,
            handle: shopifyProduct?.handle ?? null,
            imageUrl: shopifyProduct?.image_url ?? null,
          }

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save product')
      }

      if (data.product) {
        if (isEditMode) {
          onUpdated?.(data.product)
        } else {
          onAdded(data.product)
        }
      }
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  const selectedStore = stores.find(s => s.id === selectedStoreId)
  const isConnectedStore = selectedStore?.shop_domain != null

  if (loadingStores) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
          <div className="text-sm text-gray-500">Loading stores...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <h2 className="font-extrabold text-lg">{isEditMode ? 'Edit Product' : 'Add Product'}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isEditMode ? 'Update your product listing details.' : 'Add from Shopify or enter manually.'}
          </p>
        </div>

        <form onSubmit={handleSave} className="px-7 py-5 space-y-4">
          
          {/* Store Selection */}
          {!isEditMode && (
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
                Select Store *
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => {
                  setSelectedStoreId(e.target.value)
                  setSelectedShopifyProduct('')
                  setTitle('')
                  setOurPrice('')
                }}
                className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
                required
              >
                <option value="">Choose a store...</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>
                    {store.store_name || store.shop_domain || 'Unnamed Store'}
                    {store.shop_domain ? ' (Connected)' : ' (Manual)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Input Method Toggle */}
          {!isEditMode && selectedStoreId && isConnectedStore && (
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
                Input Method
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInputMethod('shopify')
                    setSelectedShopifyProduct('')
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                    inputMethod === 'shopify'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  From Shopify
                </button>
                <button
                  type="button"
                  onClick={() => setInputMethod('manual')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                    inputMethod === 'manual'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Manual Entry
                </button>
              </div>
            </div>
          )}

          {/* Shopify Product Selector */}
          {inputMethod === 'shopify' && isConnectedStore && (
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
                Shopify Product *
              </label>
              {loadingProducts ? (
                <div className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-400">
                  Loading products...
                </div>
              ) : shopifyProducts.length === 0 ? (
                <div className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-400">
                  No products found in this store
                </div>
              ) : (
                <select
                  value={selectedShopifyProduct}
                  onChange={(e) => setSelectedShopifyProduct(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
                  required
                >
                  <option value="">Choose a product...</option>
                  {shopifyProducts.map(prod => (
                    <option key={prod.shopify_product_id} value={prod.shopify_product_id}>
                      {prod.title} {prod.price ? `- $${prod.price}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Product Name */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Product Name *
            </label>
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Wireless Headphones Model X"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
              disabled={inputMethod === 'shopify' && !selectedShopifyProduct}
            />
          </div>

          {/* Currency */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Main Currency
            </label>
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

          {/* Price */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5 uppercase tracking-wide">
              Your Price (optional)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={ourPrice}
              onChange={e => setOurPrice(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
              disabled={inputMethod === 'shopify' && !selectedShopifyProduct}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose} 
              className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={saving || !title || !selectedStoreId} 
              className="flex-1 bg-black text-white font-bold text-sm py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Product')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
