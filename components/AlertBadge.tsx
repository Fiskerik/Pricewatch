interface Props { alert: any }

export default function AlertBadge({ alert }: Props) {
  const dropped = alert.new_price < alert.old_price
  const label = alert.competitor_urls?.label || 'Competitor'
  const product = alert.competitor_urls?.products?.title || 'Product'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${dropped ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {dropped ? '↓' : '↑'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{label} on <span className="text-gray-500">{product}</span></div>
        <div className="text-xs text-gray-400">{new Date(alert.sent_at).toLocaleString()}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-gray-400 line-through">${alert.old_price?.toFixed(2)}</div>
        <div className={`text-sm font-bold ${dropped ? 'text-green-600' : 'text-red-500'}`}>${alert.new_price?.toFixed(2)}</div>
      </div>
    </div>
  )
}
