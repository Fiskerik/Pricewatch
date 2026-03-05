

const provider = process.env.EMAIL_PROVIDER
  ?? (process.env.RESEND_API_KEY ? 'resend' : process.env.GMAIL_USER ? 'gmail' : 'none')

function fmtPrice(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function buildEmail(params: PriceAlertParams): { subject: string; html: string } {
  const { productTitle, competitorLabel, competitorUrl, oldPrice, newPrice, ourPrice, currency = 'USD' } = params
  const dropped = newPrice < oldPrice
  const diff = Math.abs(newPrice - oldPrice)
  const pct = Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1)
  const accent = dropped ? '#16a34a' : '#dc2626'
  const bg = dropped ? '#f0fdf4' : '#fef2f2'
  const border = dropped ? '#86efac' : '#fca5a5'

  let hostname = competitorUrl
  try { hostname = new URL(competitorUrl).hostname } catch { /* keep raw */ }
  const name = competitorLabel || hostname

  const subject = `${dropped ? '↓' : '↑'} ${name} ${dropped ? 'dropped' : 'raised'} price on "${productTitle}" — now ${fmtPrice(newPrice, currency)}`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:40px 0;background:#f4f4f5;font-family:Inter,system-ui,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="background:${accent};padding:28px 32px">
    <div style="font-size:11px;color:rgba(255,255,255,0.75);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Price ${dropped ? 'Drop' : 'Increase'} Detected</div>
    <div style="font-size:22px;font-weight:800;color:#fff">${name}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">${productTitle}</div>
  </div>
  <div style="padding:28px 32px">
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
    <div style="background:#f9f9fb;border-radius:8px;padding:12px 16px;font-size:13px;color:#52525b;margin-bottom:24px">
      ${dropped ? '↓' : '↑'} <strong>${fmtPrice(diff, currency)} (${pct}%)</strong> ${dropped ? 'cheaper' : 'more expensive'} than before
      ${ourPrice ? ` &nbsp;&middot;&nbsp; Your price: <strong>${fmtPrice(ourPrice, currency)}</strong>` : ''}
    </div>
    <a href="${competitorUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
      View on ${name} &rarr;
    </a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f0f0f0;font-size:11px;color:#a1a1aa;text-align:center">
    PriceWatch &nbsp;&middot;&nbsp;
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#a1a1aa;text-decoration:underline">Dashboard</a>
    &nbsp;&middot;&nbsp;
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings" style="color:#a1a1aa;text-decoration:underline">Manage alerts</a>
  </div>
</div>
</body></html>`

  return { subject, html }
}

async function sendViaResend(to: string, subject: string, html: string) {
  const { Resend } = await import('resend')
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not set')
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev'
  const resend = new Resend(apiKey)
  await resend.emails.send({ from, to, subject, html })
}

async function sendViaGmail(to: string, subject: string, html: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer')
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must both be set')
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  await transporter.sendMail({ from: `PriceWatch <${user}>`, to, subject, html })
}

async function sendViaSendGrid(to: string, subject: string, html: string) {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey) throw new Error('SENDGRID_API_KEY not set')
  if (!from) throw new Error('EMAIL_FROM (verified sender email) must be set for SendGrid')
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'PriceWatch' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text().catch(() => '')}`)
}

export interface PriceAlertParams {
  to: string
  productTitle: string
  competitorLabel: string
  competitorUrl: string
  oldPrice: number
  newPrice: number
  ourPrice: number
  currency?: string
}

export async function sendPriceAlert(params: PriceAlertParams): Promise<void> {
  const { subject, html } = buildEmail(params)
  console.log(`[email] sending via ${provider} to ${params.to}`)
  switch (provider) {
    case 'gmail':    return sendViaGmail(params.to, subject, html)
    case 'sendgrid': return sendViaSendGrid(params.to, subject, html)
    case 'resend':   return sendViaResend(params.to, subject, html)
    case 'none':
      console.warn('[email] No provider configured — alert skipped. Set EMAIL_PROVIDER in Vercel env vars.')
      return
    default:
      throw new Error(`Unknown EMAIL_PROVIDER="${provider}"`)
  }
}
