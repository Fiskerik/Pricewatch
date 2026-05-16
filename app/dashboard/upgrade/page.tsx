'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UpgradePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async (plan: 'pro' | 'business') => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/shopify/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        // If it says connect store first
        if (data.error?.toLowerCase().includes('connect a shopify store')) {
          router.push('/dashboard/connect-shopify');
          return;
        }
        throw new Error(data.error || 'Failed to start upgrade');
      }

      // Success → redirect to Shopify billing confirmation
      window.location.href = data.url;
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-12 p-8 bg-white rounded-2xl shadow border border-gray-100">
      <h1 className="text-3xl font-bold mb-2">Upgrade your plan</h1>
      <p className="text-gray-600 mb-8">Choose the plan that best fits your needs.</p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <button
          onClick={() => handleUpgrade('pro')}
          disabled={loading}
          className="w-full p-6 border-2 border-purple-600 hover:bg-purple-50 rounded-2xl text-left transition-all group"
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xl font-semibold">Pro — $15/month</div>
              <div className="text-sm text-gray-600 mt-1">Higher limits, etc.</div>
            </div>
            <span className="text-purple-600 font-medium group-hover:translate-x-1 transition">→</span>
          </div>
        </button>

        <button
          onClick={() => handleUpgrade('business')}
          disabled={loading}
          className="w-full p-6 border-2 border-purple-600 hover:bg-purple-50 rounded-2xl text-left transition-all group"
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xl font-semibold">Business — $39/month</div>
              <div className="text-sm text-gray-600 mt-1">Unlimited + more features</div>
            </div>
            <span className="text-purple-600 font-medium group-hover:translate-x-1 transition">→</span>
          </div>
        </button>
      </div>

      {loading && <p className="text-center mt-6 text-sm text-gray-500">Redirecting to Shopify...</p>}
    </div>
  );
}
