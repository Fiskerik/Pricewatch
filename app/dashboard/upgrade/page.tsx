"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UpgradePage() {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  // Simple plans list definition
  const plans = [
    { id: "free", name: "Free", price: 0, description: "Track up to 3 products" },
    { id: "growth", name: "Growth", price: 19, description: "Track up to 20 products" },
    { id: "pro", name: "Pro", price: 49, description: "Track up to 100 products" }
  ];

  const handleUpgrade = async (planId: string) => {
    setLoading(planId);
    try {
      const res = await fetch("/api/shopify/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      
      const data = await res.json();
      if (data.url) {
        // Break out of framing contexts safely to prevent Shopify billing redirect security errors
        if (window.top) {
          window.top.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      } else {
        alert(data.error || "Something went wrong");
      }
    } catch (err) {
      alert("Failed to initiate checkout");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Upgrade Subscription Plan</h1>
      <p className="text-gray-600 mb-8">Choose the plan that fits your pricing intelligence tracking volume.</p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.id} className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-2">{plan.name}</h2>
              <p className="text-gray-500 text-sm mb-4">{plan.description}</p>
              <div className="text-3xl font-bold mb-6">
                ${plan.price}<span className="text-sm font-normal text-gray-500">/mo</span>
              </div>
            </div>
            
            <button
              onClick={() => handleUpgrade(plan.id)}
              disabled={loading !== null}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition disabled:opacity-50"
            >
              {loading === plan.id ? "Processing..." : plan.price === 0 ? "Downgrade" : "Upgrade"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
