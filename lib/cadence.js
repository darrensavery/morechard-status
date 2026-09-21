// Pure cadence rules. Called every 10 minutes by the cadence tick; nothing
// here mutates state or sends anything - it only says what is due now.

import { CADENCE_MINUTES } from './model.js'
import { parseIso, minutesBetween } from './time.js'

// Once an incident is overdue, nag again at most this often.
export const NAG_REPEAT_MINUTES = 10
// Nag the operator this long before a maintenance window auto-completes.
export const END_NAG_MINUTES = 10

const HOUR = 3600000

export function overdueIncidents(incidents, now) {
  return incidents.filter(i => {
    if (i.status === 'resolved') return false
    const last = parseIso(i.updates[i.updates.length - 1].at)
    if (minutesBetween(last, now) < CADENCE_MINUTES[i.status]) return false
    const lastNag = i.nags.length ? parseIso(i.nags[i.nags.length - 1].at) : null
    return !lastNag || minutesBetween(lastNag, now) >= NAG_REPEAT_MINUTES
  })
}

// Returns [{ type, maintenance }] with type in
// t24h | t1h | start | end_nag | complete. Reminders are never sent late: a
// tick that lands inside the last hour with nothing sent fires only t1h, and
// a scheduled window whose start has already passed just starts.
export function dueMaintenanceActions(maintenance, now) {
  const out = []
  const t = now.getTime()
  for (const m of maintenance) {
    const start = parseIso(m.starts_at).getTime()
    const end = parseIso(m.ends_at).getTime()
    if (m.state === 'scheduled') {
      if (t >= start) { out.push({ type: 'start', maintenance: m }); continue }
      if (!m.sent.t24h && t >= start - 24 * HOUR && t < start - HOUR) out.push({ type: 't24h', maintenance: m })
      else if (!m.sent.t1h && t >= start - HOUR) out.push({ type: 't1h', maintenance: m })
    } else if (m.state === 'in_progress') {
      if (t >= end) out.push({ type: 'complete', maintenance: m })
      else if (!m.sent.end_nag && t >= end - END_NAG_MINUTES * 60000) out.push({ type: 'end_nag', maintenance: m })
    }
  }
  return out
}
