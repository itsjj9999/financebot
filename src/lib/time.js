import process from 'node:process'

// Timezone used for report-day boundaries. Configurable via the REPORT_TIME_ZONE
// environment variable (any IANA zone name, e.g. "UTC", "America/New_York").
export const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || 'UTC'

export function dateInTimeZone (value = new Date(), timeZone = REPORT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function reportDate () {
  return dateInTimeZone(new Date())
}

export function validateReportDate (value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error('Date must use YYYY-MM-DD.')
  }
  return value
}
