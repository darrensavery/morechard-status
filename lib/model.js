// Data model for the status system. Records live as JSON files under
// status/data/ on main (never in D1: if D1 is down we still need to be able
// to say so). Every mutator validates, mutates the in-memory store in place,
// and returns the record. Component status is derived, never hand-edited.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseIso, isoNow } from './time.js'

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved']
export const IMPACTS = ['minor', 'major', 'critical']
// Maximum minutes between customer-facing updates while an incident is open.
export const CADENCE_MINUTES = { investigating: 30, identified: 30, monitoring: 60 }
// Anything sooner than this is an incident, not maintenance.
export const MIN_NOTICE_HOURS = 48

const IMPACT_TO_STATUS = { minor: 'degraded', major: 'partial_outage', critical: 'major_outage' }
const SEVERITY = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 }
const EMPTY_SENT = () => ({ scheduled: null, t24h: null, t1h: null, started: null, end_nag: null, complete: null, cancelled: null, extended: [] })

export class ValidationError extends Error {}
const fail = msg => { throw new ValidationError(msg) }

// ── Persistence ──────────────────────────────────────────────────────────────

function readDir(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

export function loadStore(dataDir) {
  const components = JSON.parse(readFileSync(join(dataDir, 'components.json'), 'utf8'))
  const incidents = readDir(join(dataDir, 'incidents')).sort((a, b) => b.opened_at.localeCompare(a.opened_at))
  const maintenance = readDir(join(dataDir, 'maintenance')).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  return { components, incidents, maintenance }
}

export function saveStore(dataDir, store, now = new Date()) {
  store.components = deriveComponents(store.components, store.incidents, store.maintenance, now)
  const w = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8')
  w(join(dataDir, 'components.json'), store.components)
  for (const i of store.incidents) w(join(dataDir, 'incidents', `${i.id}.json`), i)
  for (const m of store.maintenance) w(join(dataDir, 'maintenance', `${m.id}.json`), m)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function slugId(title, dateIso, existingIds) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event'
  const base = `${dateIso.slice(0, 10)}-${slug}`
  let id = base
  let n = 2
  while (existingIds.includes(id)) id = `${base}-${n++}`
  return id
}

function requireText(v, name) {
  if (typeof v !== 'string' || !v.trim()) fail(`${name} is required.`)
  return v.trim()
}

function requireComponents(store, ids) {
  if (!Array.isArray(ids) || ids.length === 0) fail('At least one component is required.')
  for (const id of ids) if (!store.components.some(c => c.id === id)) fail(`Unknown component: ${id}`)
  return [...new Set(ids)]
}

function requireFutureIso(v, now, name) {
  if (!v) fail(`${name} is required.`)
  let d
  try { d = parseIso(v) } catch { fail(`${name} must be a UTC ISO timestamp like 2026-09-21T20:30:00Z.`) }
  if (d.getTime() <= now.getTime()) fail(`${name} must be in the future.`)
  return isoNow(d)
}

function findOrFail(list, id, what) {
  const r = list.find(x => x.id === id)
  if (!r) fail(`No ${what} with id ${id}.`)
  return r
}

export function deriveComponents(components, incidents, maintenance, _now) {
  return components.map(c => {
    let status = 'operational'
    const bump = s => { if (SEVERITY[s] > SEVERITY[status]) status = s }
    for (const m of maintenance) if (m.state === 'in_progress' && m.components.includes(c.id)) bump('maintenance')
    for (const i of incidents) if (i.status !== 'resolved' && i.components.includes(c.id)) bump(IMPACT_TO_STATUS[i.impact])
    return { ...c, status }
  })
}

function rederive(store, now) {
  store.components = deriveComponents(store.components, store.incidents, store.maintenance, now)
}

// ── Incidents ────────────────────────────────────────────────────────────────

export function openIncident(store, input, now) {
  const title = requireText(input.title, 'Title')
  if (!IMPACTS.includes(input.impact)) fail(`Impact must be one of ${IMPACTS.join(', ')}.`)
  const components = requireComponents(store, input.components)
  const eta = requireFutureIso(input.eta, now, 'ETA')
  const body = requireText(input.body, 'Update text')
  const at = isoNow(now)
  const inc = {
    id: slugId(title, at, store.incidents.map(i => i.id)),
    title,
    status: 'investigating',
    impact: input.impact,
    components,
    eta,
    opened_at: at,
    resolved_at: null,
    summary: null,
    updates: [{ at, status: 'investigating', eta, body, emailed: false }],
    nags: [],
  }
  store.incidents.unshift(inc)
  rederive(store, now)
  return inc
}

export function updateIncident(store, id, input, now) {
  const inc = findOrFail(store.incidents, id, 'incident')
  if (inc.status === 'resolved') fail('This incident is resolved. Open a new one instead.')
  if (!INCIDENT_STATUSES.includes(input.status) || input.status === 'resolved') {
    fail('Status must be investigating, identified or monitoring. Use resolve to close.')
  }
  const body = requireText(input.body, 'Update text')
  const eta = input.eta ? requireFutureIso(input.eta, now, 'ETA') : inc.eta
  const transitioned = input.status !== inc.status
  inc.status = input.status
  inc.eta = eta
  inc.updates.push({ at: isoNow(now), status: input.status, eta, body, emailed: false })
  rederive(store, now)
  return { incident: inc, transitioned }
}

export function resolveIncident(store, id, input, now) {
  const inc = findOrFail(store.incidents, id, 'incident')
  if (inc.status === 'resolved') fail('Already resolved.')
  const body = requireText(input.body, 'Update text')
  inc.summary = requireText(input.summary, 'Summary')
  inc.status = 'resolved'
  inc.resolved_at = isoNow(now)
  inc.updates.push({ at: inc.resolved_at, status: 'resolved', eta: null, body, emailed: false })
  rederive(store, now)
  return inc
}

// ── Maintenance ──────────────────────────────────────────────────────────────

function validateWindow(starts_at, ends_at, now, enforceNotice) {
  let s, e
  try { s = parseIso(starts_at); e = parseIso(ends_at) } catch { fail('Start and end must be UTC ISO timestamps like 2026-10-04T02:00:00Z.') }
  if (e.getTime() <= s.getTime()) fail('End must be after start.')
  if (enforceNotice && s.getTime() - now.getTime() < MIN_NOTICE_HOURS * 3600000) {
    fail(`Windows inside ${MIN_NOTICE_HOURS} hours are incidents, not maintenance. Open an incident with an honest ETA instead.`)
  }
  return [isoNow(s), isoNow(e)]
}

export function scheduleMaintenance(store, input, now) {
  const title = requireText(input.title, 'Title')
  const components = requireComponents(store, input.components)
  const impact = requireText(input.impact, 'Impact')
  const body = requireText(input.body, 'Body')
  const [starts_at, ends_at] = validateWindow(input.starts_at, input.ends_at, now, true)
  const m = {
    id: slugId(title, starts_at, store.maintenance.map(x => x.id)),
    title,
    state: 'scheduled',
    starts_at,
    ends_at,
    components,
    impact,
    body,
    created_at: isoNow(now),
    sent: EMPTY_SENT(),
  }
  store.maintenance.unshift(m)
  rederive(store, now)
  return m
}

export function extendMaintenance(store, id, ends_at, now) {
  const m = findOrFail(store.maintenance, id, 'maintenance window')
  if (!['scheduled', 'in_progress'].includes(m.state)) fail('Only scheduled or in-progress windows can be extended.')
  let e
  try { e = parseIso(ends_at) } catch { fail('New end must be a UTC ISO timestamp.') }
  if (e.getTime() <= parseIso(m.ends_at).getTime()) fail('New end must be later than the current end.')
  m.ends_at = isoNow(e)
  m.sent.end_nag = null
  m.sent.extended.push({ at: isoNow(now), ends_at: m.ends_at, emailed: false })
  return m
}

export function rescheduleMaintenance(store, id, starts_at, ends_at, now) {
  const m = findOrFail(store.maintenance, id, 'maintenance window')
  if (m.state !== 'scheduled') fail('Only scheduled windows can be rescheduled.')
  ;[m.starts_at, m.ends_at] = validateWindow(starts_at, ends_at, now, true)
  m.sent.t24h = null
  m.sent.t1h = null
  m.sent.end_nag = null
  m.sent.rescheduled = 'pending'
  return m
}

export function cancelMaintenance(store, id, now) {
  const m = findOrFail(store.maintenance, id, 'maintenance window')
  if (m.state !== 'scheduled') fail('Only scheduled windows can be cancelled.')
  m.state = 'cancelled'
  m.cancelled_at = isoNow(now)
  rederive(store, now)
  return m
}
