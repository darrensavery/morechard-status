// Orchestration: applies operator commands, turns due cadence actions into
// state changes and nags, and flushes owed emails. All sends are recorded in
// the store (`emailed` / `sent.*`) so a re-run never double-sends and a
// failed send is retried on the next tick.

import * as M from './model.js'
import * as E from './email.js'
import { overdueIncidents, dueMaintenanceActions } from './cadence.js'
import { isoNow } from './time.js'

export const nagTitle = i => `Status: update overdue - ${i.title}`
export const endNagTitle = m => `Status: maintenance ending soon - ${m.title}`

// Email paying parents on open, on every status transition, and on resolve.
// Same-status "still working on it" updates go to the page only.
export function shouldEmailUpdate(updates, idx) {
  if (idx === 0) return true
  const u = updates[idx]
  return u.status === 'resolved' || u.status !== updates[idx - 1].status
}

export function runPost(store, cmd, a, now) {
  switch (cmd) {
    case 'open':       return { record: M.openIncident(store, a, now) }
    case 'update':     return { record: M.updateIncident(store, a.id, a, now).incident }
    case 'resolve':    return { record: M.resolveIncident(store, a.id, a, now) }
    case 'schedule':   return { record: M.scheduleMaintenance(store, a, now) }
    case 'extend':     return { record: M.extendMaintenance(store, a.id, a.ends_at, now) }
    case 'reschedule': return { record: M.rescheduleMaintenance(store, a.id, a.starts_at, a.ends_at, now) }
    case 'cancel':     return { record: M.cancelMaintenance(store, a.id, now) }
    default: throw new M.ValidationError(`Unknown command: ${cmd}. Use open, update, resolve, schedule, extend, reschedule or cancel.`)
  }
}

async function trySend(deps, audience, email, log) {
  try {
    await deps.resend.sendBroadcast(deps.audiences[audience], email)
    return true
  } catch (err) {
    log(`[status] broadcast "${email.subject}" failed, will retry next tick: ${err.message}`)
    return false
  }
}

export async function flushEmails(store, deps, now, log = console.error) {
  const stamp = isoNow(now)

  for (const i of store.incidents) {
    for (let k = 0; k < i.updates.length; k++) {
      const u = i.updates[k]
      if (u.emailed) continue
      if (!shouldEmailUpdate(i.updates, k)) { u.emailed = true; continue }
      const build = k === 0 ? E.incidentOpened : u.status === 'resolved' ? E.incidentResolved : E.incidentStatusChanged
      // Render the incident as it was at that update, so a retry of an old
      // update does not leak a later status into an earlier email.
      const snapshot = { ...i, updates: i.updates.slice(0, k + 1), status: u.status, eta: u.eta ?? i.eta }
      if (await trySend(deps, 'paying', build(snapshot), log)) u.emailed = true
    }
    if (i.status === 'resolved' && !i.nag_closed) {
      deps.github.closeIssuesByTitle(nagTitle(i), 'Resolved.')
      i.nag_closed = true
    }
  }

  for (const m of store.maintenance) {
    const s = m.sent
    if (m.state === 'scheduled' || m.state === 'in_progress') {
      if (!s.scheduled && await trySend(deps, 'all', E.maintenanceScheduled(m), log)) s.scheduled = stamp
      if (s.t24h === 'pending' && await trySend(deps, 'all', E.maintenanceReminder(m, 't24h'), log)) s.t24h = stamp
      if (s.t1h === 'pending' && await trySend(deps, 'all', E.maintenanceReminder(m, 't1h'), log)) s.t1h = stamp
      if (s.rescheduled === 'pending' && await trySend(deps, 'all', E.maintenanceRescheduled(m), log)) s.rescheduled = stamp
      for (const x of s.extended) if (!x.emailed && await trySend(deps, 'all', E.maintenanceExtended(m), log)) x.emailed = true
    }
    if (m.state === 'complete' && s.complete === 'pending' && await trySend(deps, 'all', E.maintenanceComplete(m), log)) s.complete = stamp
    if (m.state === 'cancelled' && !s.cancelled && await trySend(deps, 'all', E.maintenanceCancelled(m), log)) s.cancelled = stamp
  }
}

export async function runTick(store, deps, now, log = console.error) {
  const before = JSON.stringify(store)
  const stamp = isoNow(now)

  for (const { type, maintenance: m } of dueMaintenanceActions(store.maintenance, now)) {
    if (type === 't24h' || type === 't1h') {
      m.sent[type] = 'pending'
    } else if (type === 'start') {
      m.state = 'in_progress'
      m.sent.started = stamp
    } else if (type === 'complete') {
      m.state = 'complete'
      m.sent.complete = 'pending'
    } else if (type === 'end_nag') {
      m.sent.end_nag = stamp
      const email = E.operatorNag({ kind: 'maintenance_end', record: m, formUrl: deps.formUrl })
      deps.github.openOrCommentIssue({ title: endNagTitle(m), body: email.text })
      await deps.resend.sendTransactional(deps.operatorEmail, email)
    }
  }

  for (const i of overdueIncidents(store.incidents, now)) {
    const email = E.operatorNag({ kind: 'incident', record: i, formUrl: deps.formUrl })
    const issue = deps.github.openOrCommentIssue({ title: nagTitle(i), body: email.text })
    await deps.resend.sendTransactional(deps.operatorEmail, email)
    i.nags.push({ at: stamp, issue })
  }

  store.components = M.deriveComponents(store.components, store.incidents, store.maintenance, now)
  await flushEmails(store, deps, now, log)
  return { changed: JSON.stringify(store) !== before }
}
