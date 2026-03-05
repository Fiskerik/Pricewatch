import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM || 'alerts@pricewatch.app'

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is required to send email alerts.')
  return new Resend(apiKey)
}

interface PriceAlertParams {
  to: string
  productTitle: string
  competitorLabel: string
  competitorUrl: string
  oldPrice: number
  newPrice: number
  ourPrice: number
  currency?: string
}

function fmtPrice(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export async function sendPriceAlert(params: PriceAlertParams) {
  const { to, productTitle, competitorLabel, competitorUrl, oldPrice, newPrice, ourPrice, currency = 'USD' } = params
  const dropped = newPrice < oldPrice
  const diff = Math.abs(newPrice - oldPrice)
  const pct = Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1)
  const accentColor = dropped ? '#16a34a' : '#dc2626'
  const bgColor = dropped ? '#f0fdf4' : '#fef2f2'
  const borderColor = dropped ? '#86efac' : '#fca5a5'

  let hostname = competitorUrl
  try { hostname = new URL(competitorUrl).hostname } catch { /* keep raw */ }
  const competitorName = competitorLabel || hostname

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:40px 0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">

    <!-- Header -->
    <div style="background:${accentColor};padding:28px 32px">
      <div style="font-size:11px;color:rgba(255,255,255,0.75);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">
        Price ${dropped ? 'Drop' : 'Increase'} Detected
      </div>
      <div style="font-size:22px;font-weight:800;color:#fff">${competitorName}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">${productTitle}</div>
    </div>

    <!-- Price comparison -->
    <div style="padding:28px 32px">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
        <tr>
          <td width="48%" style="background:#f4f4f5;border-radius:12px;padding:16px;text-align:center">
            <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Was</div>
            <div style="font-size:26px;font-weight:700;color:#a1a1aa;text-decoration:line-through">${fmtPrice(oldPrice, currency)}</div>
          </td>
          <td width="4%" style="text-align:center;font-size:20px;color:${accentColor};font-weight:800">${dropped ? '↓' : '↑'}</td>
          <td width="48%" style="background:${bgColor};border-radius:12px;padding:16px;text-align:center;border:2px solid ${borderColor}">
            <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Now</div>
            <div style="font-size:26px;font-weight:800;color:${accentColor}">${fmtPrice(newPrice, currency)}</div>
          </td>
        </tr>
      </table>

      <!-- Summary line -->
      <div style="background:#f9f9fb;border-radius:8px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:24px">
        ${dropped ? '↓' : '↑'} <strong>${fmtPrice(diff, currency)} (${pct}%)</strong> ${dropped ? 'cheaper' : 'more expensive'} than before
        ${ourPrice ? ` &nbsp;·&nbsp; Your price: <strong>${fmtPrice(ourPrice, currency)}</strong>` : ''}
      </div>

      <!-- CTA -->
      <a href="${competitorUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
        View on ${competitorName} &rarr;
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#a1a1aa;text-align:center">
      PriceWatch &nbsp;&middot;&nbsp;
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#a1a1aa;text-decoration:underline">Open Dashboard</a>
      &nbsp;&middot;&nbsp;
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings" style="color:#a1a1aa;text-decoration:underline">Manage alerts</a>
    </div>
  </div>
</body>
</html>`

  const resend = getResendClient()
  return resend.emails.send({
    from: FROM,
    to,
    subject: `${dropped ? '↓' : '↑'} ${competitorName} ${dropped ? 'dropped' : 'raised'} price on "${productTitle}" — now ${fmtPrice(newPrice, currency)}`,
    html,
  })
}
