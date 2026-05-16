'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UpgradePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initiateUpgrade();
  }, []);

  const initiateUpgrade = async (plan: 'pro' | 'business' = 'pro') => {
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
        if (data.error?.includes('Connect a Shopify store')) {
          router.push('/dashboard/connect-shopify');
          return;
        }
        throw new Error(data.error || 'Failed to start upgrade');
      }

      // Redirect to Shopify's confirmation page
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Optional: show plan selection if you want to keep both buttons
  return (
    <div className="max-w-md mx-auto mt-12 p-8 bg-white rounded-xl shadow">
      <h1 className="text-2xl font-bold mb-6">Upgrade your plan</h1>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <button
          onClick={() => initiateUpgrade('pro')}
          disabled={loading}
          className="w-full p-6 border-2 border-purple-600 rounded-xl hover:bg-purple-50 text-left"
        >
          <div className="font-semibold text-lg">Pro — $15/month</div>
          <div className="text-sm text-gray-600 mt-1">Higher limits, etc.</div>
        </button>

        <button
          onClick={() => initiateUpgrade('business')}
          disabled={loading}
          className="w-full p-6 border-2 border-purple-600 rounded-xl hover:bg-purple-50 text-left"
        >
          <div className="font-semibold text-lg">Business — $39/month</div>
          <div className="text-sm text-gray-600 mt-1">Unlimited + more features</div>
        </button>
      </div>

      {loading && <p className="text-center mt-4 text-sm text-gray-500">Redirecting to Shopify...</p>}
    </div>
  );
}
