'use client'
import { useState, useRef, useEffect } from 'react'

export interface VatCountry {
  code: string
  name: string
  flag: string
  rate: number
}

export const VAT_COUNTRIES: VatCountry[] = [
  { code: 'NONE', name: 'No VAT', flag: '🚫', rate: 0 },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', rate: 25 },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', rate: 25 },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', rate: 25 },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', rate: 24 },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', rate: 19 },
  { code: 'FR', name: 'France', flag: '🇫🇷', rate: 20 },
  { code: 'GB', name: 'UK', flag: '🇬🇧', rate: 20 },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', rate: 21 },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', rate: 21 },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', rate: 22 },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', rate: 23 },
  { code: 'AT', name: 'Austria', flag: '🇦🇹', rate: 20 },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', rate: 21 },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', rate: 23 },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', rate: 8 },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', rate: 10 },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', rate: 15 },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', rate: 9 },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', rate: 10 },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', rate: 5 },
  { code: 'US', name: 'USA', flag: '🇺🇸', rate: 0 },
]

// Detect country from browser locale/timezone
export function detectCountryCode(): string {
  if (typeof window === 'undefined') return 'SE'
  const locales = [...(navigator.languages ?? []), navigator.language]
  for (const locale of locales) {
    const parts = locale.replace('_', '-').split('-')
    const region = parts[parts.length - 1]?.toUpperCase()
    if (region && region.length === 2 && VAT_COUNTRIES.find(c => c.code === region)) {
      return region
    }
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzMap: Record<string, string> = {
    'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK',
    'Europe/Helsinki': 'FI', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
    'Europe/London': 'GB', 'Europe/Amsterdam': 'NL', 'Europe/Madrid': 'ES',
    'Europe/Rome': 'IT', 'Europe/Warsaw': 'PL', 'Europe/Vienna': 'AT',
    'Europe/Brussels': 'BE', 'Europe/Dublin': 'IE', 'Europe/Zurich': 'CH',
    'Australia/Sydney': 'AU', 'Pacific/Auckland': 'NZ', 'Asia/Singapore': 'SG',
    'Asia/Tokyo': 'JP', 'America/Toronto': 'CA',
  }
  return tzMap[tz] ?? 'SE'
}

interface Props {
  countryCode: string
  onChange: (code: string, rate: number) => void
}

export default function VatCountrySelector({ countryCode, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = VAT_COUNTRIES.find(c => c.code === countryCode) ?? VAT_COUNTRIES[0]

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-400 transition-colors"
        title={`VAT: ${selected.rate}% (${selected.name})`}
      >
        <span className="text-base leading-none">{selected.flag}</span>
        <span>{selected.rate > 0 ? `+${selected.rate}% VAT` : 'No VAT'}</span>
        <span className="text-gray-400 text-[10px]">▼</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-52 py-1.5 max-h-72 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Select country / VAT rate
          </div>
          {VAT_COUNTRIES.map(country => (
            <button
              key={country.code}
              type="button"
              onClick={() => {
                onChange(country.code, country.rate)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors ${
                country.code === countryCode ? 'bg-gray-50 font-semibold' : ''
              }`}
            >
              <span className="text-base">{country.flag}</span>
              <span className="flex-1">{country.name}</span>
              <span className="text-xs text-gray-400 shrink-0">
                {country.rate > 0 ? `${country.rate}%` : '—'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
