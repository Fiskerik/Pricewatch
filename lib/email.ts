export interface PriceAlertParams {
  to: string
  productTitle: string
  competitorLabel: string
  competitorUrl: string
  oldPrice: number
  newPrice: number
  ourPrice: number
  currency?: string
  ourPriceCurrency?: string
}

export interface EmailSendDebug {
  skipped: boolean
  reason?: 'missing_resend_api_key'
  provider: 'resend'
  messageId?: string | null
  to: string
  from: string
  subject: string
}

export interface AutoPriceSuggestionParams {
  to: string
  productTitle: string
  currentPrice: number
  suggestedPrice: number
  lowestCompetitorPrice: number
  currency?: string
  applied?: boolean  // ← new
}

export interface StockAlertParams {
  to: string
  productTitle: string
  competitorLabel: string
  competitorUrl: string
  previousStatus: 'in_stock' | 'out_of_stock' | 'unknown'
  newStatus: 'in_stock' | 'out_of_stock'
}


function fmtPrice(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export async function sendPriceAlert(params: PriceAlertParams): Promise<EmailSendDebug> {
  const {
    to,
    productTitle,
    competitorLabel,
    competitorUrl,
    oldPrice,
    newPrice,
    ourPrice,
    currency = 'USD',
    ourPriceCurrency,
  } = params

  const dropped = newPrice < oldPrice
  const diff = Math.abs(newPrice - oldPrice)
  const pct = oldPrice === 0
    ? 'N/A'
    : Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1)
  const accent = dropped ? '#16a34a' : '#dc2626'
  const bg = dropped ? '#f0fdf4' : '#fef2f2'
  const border = dropped ? '#86efac' : '#fca5a5'

  let hostname = competitorUrl
  try { hostname = new URL(competitorUrl).hostname } catch { /* keep raw */ }
  const name = competitorLabel || hostname

  const subject = `${name} ${dropped ? 'price drop' : 'price update'}: ${fmtPrice(newPrice, currency)} for ${productTitle}`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 12px;background:#f4f4f5;font-family:Inter,system-ui,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="background:${accent};padding:24px 28px">
    <div style="font-size:11px;color:rgba(255,255,255,0.78);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Pricingspy Alert</div>
    <div style="font-size:24px;line-height:1.25;font-weight:800;color:#fff;margin:0">${dropped ? 'Price dropped' : 'Price updated'}</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.86);margin-top:6px">${name} changed price for <strong>${productTitle}</strong>.</div>
  </div>
  <div style="padding:24px 28px">
    <div style="font-size:14px;color:#3f3f46;line-height:1.6;margin-bottom:16px">
      We detected a new competitor price and compared it to your latest tracked value.
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <td width="48%" style="background:#f4f4f5;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase">Was</div>
          <div style="font-size:26px;font-weight:700;color:#a1a1aa;text-decoration:line-through">${fmtPrice(oldPrice, currency)}</div>
        </td>
        <td width="4%" style="text-align:center;font-size:20px;color:${accent};font-weight:800">${dropped ? '↓' : '↑'}</td>
        <td width="48%" style="background:${bg};border-radius:12px;padding:16px;text-align:center;border:2px solid ${border}">
          <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase">Now</div>
          <div style="font-size:26px;font-weight:800;color:${accent}">${fmtPrice(newPrice, currency)}</div>
        </td>
      </tr>
    </table>
    <div style="background:#f9f9fb;border-radius:10px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:22px;line-height:1.5">
      ${dropped ? '↓' : '↑'} <strong>${fmtPrice(diff, currency)}${pct === 'N/A' ? '' : ` (${pct}%)`}</strong> ${dropped ? 'cheaper' : 'more expensive'} than before
      ${ourPrice ? ` &nbsp;&middot;&nbsp; Your price: <strong>${fmtPrice(ourPrice, ourPriceCurrency ?? currency)}</strong>` : ''}
    </div>
    <a href="${competitorUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
      View on ${name} &rarr;
    </a>
  </div>
  <div style="padding:16px 28px 20px;border-top:1px solid #f0f0f0;font-size:11px;color:#71717a;text-align:center;line-height:1.6">
    Not seeing alerts? Check your spam/junk folder and add <strong>onboarding@resend.dev</strong> as a safe sender.<br/>
    Pricingspy &nbsp;&middot;&nbsp;
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#a1a1aa;text-decoration:underline">Dashboard</a>
    &nbsp;&middot;&nbsp;
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings" style="color:#a1a1aa;text-decoration:underline">Manage alerts</a>
  </div>
</div>
</body></html>`

  const apiKey = process.env.RESEND_KEY ?? process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  if (!apiKey) {
    return {
      skipped: true,
      reason: 'missing_resend_api_key',
      provider: 'resend',
      messageId: null,
      to,
      from,
      subject,
    }
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({ from, to, subject, html })

  if (result?.error) {
    throw new Error(`Resend send failed: ${result.error.message}`)
  }

  return {
    skipped: false,
    provider: 'resend',
    messageId: result?.data?.id ?? null,
    to,
    from,
    subject,
  }
}

export async function sendStockAlert(params: StockAlertParams): Promise<EmailSendDebug> {
  const { to, productTitle, competitorLabel, competitorUrl, previousStatus, newStatus } = params
  const isOos = newStatus === 'out_of_stock'
  const accent = isOos ? '#7c3aed' : '#0f766e'
  const bg = isOos ? '#f5f3ff' : '#ecfeff'

  let hostname = competitorUrl
  try { hostname = new URL(competitorUrl).hostname } catch { /* keep raw */ }
  const name = competitorLabel || hostname
  const subject = `${name} is now ${isOos ? 'out of stock' : 'back in stock'} for ${productTitle}`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 12px;background:#f4f4f5;font-family:Inter,system-ui,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="background:${accent};padding:24px 28px">
    <div style="font-size:11px;color:rgba(255,255,255,0.78);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Pricingspy Stock Alert</div>
    <div style="font-size:24px;line-height:1.25;font-weight:800;color:#fff;margin:0">${isOos ? 'Competitor out of stock' : 'Competitor restocked'}</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.86);margin-top:6px">${name} stock state changed for <strong>${productTitle}</strong>.</div>
  </div>
  <div style="padding:24px 28px">
    <div style="background:${bg};border-radius:12px;padding:16px;font-size:14px;line-height:1.6;color:#27272a;margin-bottom:18px">
      Previous status: <strong>${previousStatus.replace('_', ' ')}</strong><br/>
      Current status: <strong>${newStatus.replace('_', ' ')}</strong>
    </div>
    <a href="${competitorUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
      Open competitor page &rarr;
    </a>
  </div>
</div>
</body></html>`

  const apiKey = process.env.RESEND_KEY ?? process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  if (!apiKey) {
    return {
      skipped: true,
      reason: 'missing_resend_api_key',
      provider: 'resend',
      messageId: null,
      to,
      from,
      subject,
    }
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({ from, to, subject, html })

  if (result?.error) {
    throw new Error(`Resend send failed: ${result.error.message}`)
  }

  return {
    skipped: false,
    provider: 'resend',
    messageId: result?.data?.id ?? null,
    to,
    from,
    subject,
  }
}

export interface MapViolationAlertParams {
  to: string
  productTitle: string
  competitorLabel: string
  competitorUrl: string
  competitorPrice: number
  mapFloorPrice: number
  currency?: string
}

export async function sendMapViolationAlert(params: MapViolationAlertParams): Promise<EmailSendDebug> {
  const { to, productTitle, competitorLabel, competitorUrl, competitorPrice, mapFloorPrice, currency = 'USD' } = params
  
  const gap = mapFloorPrice - competitorPrice
  const gapPct = ((gap / mapFloorPrice) * 100).toFixed(1)
  
  let hostname = competitorUrl
  try { hostname = new URL(competitorUrl).hostname } catch { /* keep raw */ }
  const name = competitorLabel || hostname
  
  const subject = `MAP violation: ${name} is advertising ${productTitle} at ${fmtPrice(competitorPrice, currency)} (floor: ${fmtPrice(mapFloorPrice, currency)})`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 12px;background:#f4f4f5;font-family:Inter,system-ui,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="background:#dc2626;padding:24px 28px">
    <div style="font-size:11px;color:rgba(255,255,255,0.78);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Pricingspy · MAP Alert</div>
    <div style="font-size:24px;line-height:1.25;font-weight:800;color:#fff;margin:0">MAP Policy Violation</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.86);margin-top:6px">
      <strong>${name}</strong> is advertising <strong>${productTitle}</strong> below your MAP floor.
    </div>
  </div>
  <div style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <td width="48%" style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase">Advertised Price</div>
          <div style="font-size:26px;font-weight:800;color:#dc2626">${fmtPrice(competitorPrice, currency)}</div>
        </td>
        <td width="4%" style="text-align:center;font-size:20px;color:#dc2626;font-weight:800">vs</td>
        <td width="48%" style="background:#f4f4f5;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#71717a;font-weight:600;margin-bottom:6px;text-transform:uppercase">MAP Floor</div>
          <div style="font-size:26px;font-weight:700;color:#6b7280">${fmtPrice(mapFloorPrice, currency)}</div>
        </td>
      </tr>
    </table>
    <div style="background:#fef2f2;border-radius:10px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:22px">
      <strong>${fmtPrice(gap, currency)} (${gapPct}%) below MAP floor.</strong> This may affect other resellers and your brand's price integrity.
    </div>
    <a href="${competitorUrl}" style="display:block;background:#dc2626;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
      View on ${name} &rarr;
    </a>
  </div>
</div>
</body></html>`

  const apiKey = process.env.RESEND_KEY ?? process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  if (!apiKey) {
    return { skipped: true, reason: 'missing_resend_api_key', provider: 'resend', messageId: null, to, from, subject }
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({ from, to, subject, html })
  if (result?.error) throw new Error(`Resend send failed: ${result.error.message}`)
  return { skipped: false, provider: 'resend', messageId: result?.data?.id ?? null, to, from, subject }
}

export async function sendAutoPriceSuggestion(params: AutoPriceSuggestionParams): Promise<EmailSendDebug> {
  const { to, productTitle, currentPrice, suggestedPrice, lowestCompetitorPrice, currency = 'USD' } = params
  const diff = currentPrice - suggestedPrice
  const subject = params.applied
  ? `Price updated: ${productTitle} → ${fmtPrice(suggestedPrice, currency)}`
  : `Reprice suggested: ${productTitle} → ${fmtPrice(suggestedPrice, currency)}`
  
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 12px;background:#f4f4f5;font-family:Inter,system-ui,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="background:#7c3aed;padding:24px 28px">
    <div style="font-size:11px;color:rgba(255,255,255,0.78);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">
${params.applied ? 'Price automatically updated' : 'Reprice opportunity'}</div>
    <div style="font-size:22px;font-weight:800;color:#fff;margin:0">Reprice opportunity for ${productTitle}</div>
  </div>
  <div style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <td style="background:#f9f9fb;border-radius:10px;padding:14px;text-align:center;width:32%">
          <div style="font-size:10px;color:#71717a;font-weight:600;text-transform:uppercase;margin-bottom:4px">Your Price</div>
          <div style="font-size:20px;font-weight:700;color:#3f3f46">${fmtPrice(currentPrice, currency)}</div>
        </td>
        <td style="text-align:center;font-size:18px;color:#7c3aed;font-weight:800;width:4%">→</td>
        <td style="background:#f5f3ff;border:2px solid #c4b5fd;border-radius:10px;padding:14px;text-align:center;width:32%">
          <div style="font-size:10px;color:#7c3aed;font-weight:600;text-transform:uppercase;margin-bottom:4px">Suggested</div>
          <div style="font-size:22px;font-weight:800;color:#7c3aed">${fmtPrice(suggestedPrice, currency)}</div>
        </td>
        <td style="text-align:center;font-size:18px;font-weight:800;width:4%"></td>
        <td style="background:#f9f9fb;border-radius:10px;padding:14px;text-align:center;width:28%">
          <div style="font-size:10px;color:#71717a;font-weight:600;text-transform:uppercase;margin-bottom:4px">Lowest Comp.</div>
          <div style="font-size:20px;font-weight:700;color:#3f3f46">${fmtPrice(lowestCompetitorPrice, currency)}</div>
        </td>
      </tr>
    </table>
    <div style="background:#f5f3ff;border-radius:10px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:22px">
      Lowering your price by <strong>${fmtPrice(diff, currency)}</strong> would make you the cheapest option by your configured margin.
    </div>
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:block;background:#7c3aed;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
      View Dashboard →
    </a>
  </div>
</div>
</body></html>`

  const apiKey = process.env.RESEND_KEY ?? process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'
  if (!apiKey) return { skipped: true, reason: 'missing_resend_api_key', provider: 'resend', messageId: null, to, from, subject }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({ from, to, subject, html })
  if (result?.error) throw new Error(`Resend send failed: ${result.error.message}`)
  return { skipped: false, provider: 'resend', messageId: result?.data?.id ?? null, to, from, subject }
}
