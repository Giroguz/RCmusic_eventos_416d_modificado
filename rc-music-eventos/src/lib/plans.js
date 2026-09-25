export const PLAN_OPTIONS = [
  { id: 'fifteen', days: 15, pricePen: 16, label: '15 días' },
  { id: 'monthly', days: 30, pricePen: 30, label: 'Mensual' },
  { id: 'annual', days: 365, pricePen: 330, label: 'Anual' },
]

export function getPlanOption(planType, plans = PLAN_OPTIONS) {
  return plans.find((plan) => plan.id === planType) || null
}

export function mergePlanOptions(rows = []) {
  const byType = Object.fromEntries(rows.map((row) => [row.plan_type || row.planType, row]))
  return PLAN_OPTIONS.map((plan) => ({ ...plan, days: Number(byType[plan.id]?.days) || plan.days, pricePen: Number(byType[plan.id]?.price_pen ?? byType[plan.id]?.pricePen) || plan.pricePen }))
}

export function formatCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, new Date(expiresAt || 0).getTime() - now)
  const totalSeconds = Math.floor(remaining / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return { days, hours, minutes, seconds, expired: remaining <= 0 }
}

export function countdownText(expiresAt, now = Date.now()) {
  const value = formatCountdown(expiresAt, now)
  return value.expired ? 'Vencido' : `${value.days}d ${String(value.hours).padStart(2, '0')}h ${String(value.minutes).padStart(2, '0')}m ${String(value.seconds).padStart(2, '0')}s`
}

export function planPriceText(plan, currency = 'PEN', rate = 1) {
  const amount = plan.pricePen * rate
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'PEN' ? 2 : 0 }).format(amount)
}

export function planUsdPriceText(plan, rate = 1) {
  const amount = plan.pricePen * rate
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)
}
