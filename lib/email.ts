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
}

export async function sendPriceAlert(params: PriceAlertParams) {
  const { to, productTitle, competitorLabel, competitorUrl, oldPrice, newPrice, ourPrice } = params
  const dropped = newPrice < oldPrice
  const diff = Math.abs(newPrice - oldPrice).toFixed(2)
  const pct = Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1)

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Inter, system-ui, sans-serif; background: #f9f9f9; padding: 40px 0;">
      <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e8e8e8;">

        <div style="background: ${dropped ? '#16a34a' : '#dc2626'}; padding: 28px 32px;">
          <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-bottom: 4px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">
            Price ${dropped ? 'Drop' : 'Increase'} Detected
          </div>
          <div style="font-size: 24px; font-weight: 800; color: #fff;">
            ${competitorLabel || new URL(competitorUrl).hostname}
          </div>
        </div>

        <div style="padding: 28px 32px;">
          <div style="font-size: 15px; font-weight: 600; color: #111; margin-bottom: 20px;">
            ${productTitle}
          </div>

          <div style="display: flex; gap: 16px; margin-bottom: 24px;">
            <div style="flex: 1; background: #f5f5f5; border-radius: 10px; padding: 16px; text-align: center;">
              <div style="font-size: 12px; color: #888; margin-bottom: 4px;">Was</div>
              <div style="font-size: 24px; font-weight: 700; color: #888; text-decoration: line-through;">$${oldPrice.toFixed(2)}</div>
            </div>
            <div style="flex: 1; background: ${dropped ? '#f0fdf4' : '#fef2f2'}; border-radius: 10px; padding: 16px; text-align: center; border: 2px solid ${dropped ? '#86efac' : '#fca5a5'};">
              <div style="font-size: 12px; color: #888; margin-bottom: 4px;">Now</div>
              <div style="font-size: 24px; font-weight: 800; color: ${dropped ? '#16a34a' : '#dc2626'};">$${newPrice.toFixed(2)}</div>
            </div>
          </div>

          <div style="background: #f9f9f9; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; color: #555;">
            ${dropped ? '↓' : '↑'} <strong>$${diff} (${pct}%)</strong> ${dropped ? 'cheaper' : 'more expensive'} than before
            ${ourPrice ? `&nbsp;·&nbsp; Your price: <strong>$${ourPrice.toFixed(2)}</strong>` : ''}
          </div>

          <a href="${competitorUrl}" style="display: block; background: #111; color: #fff; text-align: center; padding: 14px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px;">
            View on ${competitorLabel || 'Competitor Site'} →
          </a>
        </div>

        <div style="padding: 16px 32px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #aaa; text-align: center;">
          PriceWatch · <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color: #aaa;">View Dashboard</a>
        </div>
      </div>
    </body>
    </html>
  `

  const resend = getResendClient()

  return resend.emails.send({
    from: FROM,
    to,
    subject: `${dropped ? '↓' : '↑'} ${competitorLabel} changed price on "${productTitle}" — now $${newPrice.toFixed(2)}`,
    html,
  })
}
