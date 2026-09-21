// Small UTC-only time helpers. Everything in status/ takes an injected `now`
// (a Date) so the cadence logic is testable with a fake clock.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseIso(s) {
  const d = new Date(s)
  if (typeof s !== 'string' || Number.isNaN(d.getTime())) throw new Error(`Invalid ISO timestamp: ${s}`)
  return d
}

export function minutesBetween(a, b) {
  return (b.getTime() - a.getTime()) / 60000
}

export function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60000)
}

// ISO string without milliseconds, the canonical form stored in data/.
export function isoNow(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// "21 Sep 2026, 20:30 UTC" - used in emails and on the page.
export function formatUtc(iso) {
  const d = parseIso(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
