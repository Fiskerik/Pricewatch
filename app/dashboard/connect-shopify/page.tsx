"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function ConnectShopifyContent() {
  const searchParams = useSearchParams();
  const rawError = searchParams.get("error");
  const [shopDomain, setShopDomain] = useState("");
  const [loading, setLoading] = useState(false);

  // If error query parameter exists, check if it's our custom duplicate error message or format nicely
  const errorMessage = rawError ? decodeURIComponent(rawError) : null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopDomain) return;

    setLoading(true);
    try {
      // Clean up inputs if users copy-paste full URLs
      let formattedDomain = shopDomain.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
      if (!formattedDomain.endsWith(".myshopify.com")) {
        formattedDomain = `${formattedDomain}.myshopify.com`;
      }

      // Route user to your api initiate endpoint
      window.location.href = `/api/shopify/install?shop=${encodeURIComponent(formattedDomain)}`;
    } catch (err) {
      setLoading(false);
      alert("Could not initialize setup link.");
    }
  };

  return (
    <div className="p-8 max-w-md mx-auto bg-white rounded-xl shadow-md border border-gray-100 mt-12">
      <h1 className="text-xl font-bold mb-2">Connect your Shopify Store</h1>
      <p className="text-sm text-gray-500 mb-6">Enter your Shopify store URL domain to link product inventory.</p>

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg font-medium">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleConnect} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-gray-600 mb-1">Store Domain</label>
          <input
            type="text"
            placeholder="my-store.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !shopDomain}
          className="w-full bg-black hover:bg-gray-800 text-white font-medium py-2 rounded text-sm transition disabled:opacity-50"
        >
          {loading ? "Connecting..." : "Link Shopify Store"}
        </button>
      </form>
    </div>
  );
}

export default function ConnectShopifyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-gray-500">Loading component...</div>}>
      <ConnectShopifyContent />
    </Suspense>
  );
}
