import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadStore, saveStore, slugId, deriveComponents, openIncident, updateIncident, resolveIncident,
  scheduleMaintenance, extendMaintenance, rescheduleMaintenance, cancelMaintenance, ValidationError,
} from './model.js'

const NOW = new Date('2026-09-21T19:52:00Z')
const COMPONENTS = [{ id: 'api', name: 'API', status: 'operational' }, { id: 'app', name: 'App', status: 'operational' }]
function freshStore() { return { components: structuredClone(COMPONENTS), incidents: [], maintenance: [] } }
function tmpData() {
  const dir = mkdtempSync(join(tmpdir(), 'status-'))
  mkdirSync(join(dir, 'incidents')); mkdirSync(join(dir, 'maintenance'))
  writeFileSync(join(dir, 'components.json'), JSON.stringify(COMPONENTS))
  return dir
}

test('slugId builds date-slug and de-duplicates', () => {
  assert.equal(slugId('API unavailable!', '2026-09-21T19:52:00Z', []), '2026-09-21-api-unavailable')
  assert.equal(slugId('API unavailable', '2026-09-21T19:52:00Z', ['2026-09-21-api-unavailable']), '2026-09-21-api-unavailable-2')
})

test('openIncident validates ETA, body, impact, components', () => {
  const s = freshStore()
  const ok = { title: 'x', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'hi' }
  assert.throws(() => openIncident(s, { ...ok, eta: null }, NOW), ValidationError)
  assert.throws(() => openIncident(s, { ...ok, eta: '2026-09-21T19:00:00Z' }, NOW), ValidationError)
  assert.throws(() => openIncident(s, { ...ok, body: '' }, NOW), ValidationError)
  assert.throws(() => openIncident(s, { ...ok, impact: 'huge' }, NOW), ValidationError)
  assert.throws(() => openIncident(s, { ...ok, components: ['nope'] }, NOW), ValidationError)
  assert.throws(() => openIncident(s, { ...ok, components: [] }, NOW), ValidationError)
})

test('openIncident creates record and derives component status', () => {
  const s = freshStore()
  const inc = openIncident(s, { title: 'API unavailable', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'We are investigating.' }, NOW)
  assert.equal(inc.id, '2026-09-21-api-unavailable')
  assert.equal(inc.status, 'investigating')
  assert.equal(inc.updates.length, 1)
  assert.equal(inc.updates[0].emailed, false)
  assert.equal(s.components.find(c => c.id === 'api').status, 'partial_outage')
  assert.equal(s.components.find(c => c.id === 'app').status, 'operational')
})

test('updateIncident reports transitions and carries ETA forward', () => {
  const s = freshStore()
  openIncident(s, { title: 'A', impact: 'minor', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  const later = new Date('2026-09-21T20:10:00Z')
  const r1 = updateIncident(s, '2026-09-21-a', { status: 'investigating', body: 'Still looking.' }, later)
  assert.equal(r1.transitioned, false)
  assert.equal(r1.incident.updates[1].eta, '2026-09-21T20:30:00Z')
  const r2 = updateIncident(s, '2026-09-21-a', { status: 'identified', eta: '2026-09-21T21:00:00Z', body: 'Found it.' }, later)
  assert.equal(r2.transitioned, true)
  assert.equal(r2.incident.eta, '2026-09-21T21:00:00Z')
  assert.throws(() => updateIncident(s, '2026-09-21-a', { status: 'resolved', body: 'x' }, later), ValidationError)
})

test('resolveIncident needs summary, restores components, is terminal', () => {
  const s = freshStore()
  openIncident(s, { title: 'A', impact: 'critical', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  assert.throws(() => resolveIncident(s, '2026-09-21-a', { body: 'Fixed.', summary: '' }, NOW), ValidationError)
  const inc = resolveIncident(s, '2026-09-21-a', { body: 'Fixed.', summary: 'A bad deploy.' }, NOW)
  assert.equal(inc.status, 'resolved')
  assert.equal(inc.resolved_at, '2026-09-21T19:52:00Z')
  assert.equal(s.components[0].status, 'operational')
  assert.throws(() => updateIncident(s, '2026-09-21-a', { status: 'monitoring', body: 'x' }, NOW), ValidationError)
})

test('deriveComponents takes the worst of incidents and maintenance', () => {
  const inc = [{ status: 'monitoring', impact: 'minor', components: ['api'] }, { status: 'resolved', impact: 'critical', components: ['api'] }]
  const mt = [{ state: 'in_progress', components: ['api', 'app'] }]
  const out = deriveComponents(COMPONENTS, inc, mt, NOW)
  assert.equal(out.find(c => c.id === 'api').status, 'degraded')
  assert.equal(out.find(c => c.id === 'app').status, 'maintenance')
})

test('scheduleMaintenance enforces 48h notice and ordering', () => {
  const s = freshStore()
  const base = { title: 'DB upgrade', components: ['api'], impact: 'Down for an hour.', body: 'Upgrading.' }
  assert.throws(() => scheduleMaintenance(s, { ...base, starts_at: '2026-09-23T10:00:00Z', ends_at: '2026-09-23T11:00:00Z' }, NOW), /48 hours/)
  assert.throws(() => scheduleMaintenance(s, { ...base, starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T09:00:00Z' }, NOW), ValidationError)
  const m = scheduleMaintenance(s, { ...base, starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z' }, NOW)
  assert.equal(m.id, '2026-09-25-db-upgrade')
  assert.equal(m.state, 'scheduled')
  assert.deepEqual(m.sent, { scheduled: null, t24h: null, t1h: null, started: null, end_nag: null, complete: null, cancelled: null, extended: [] })
})

test('extend/reschedule/cancel', () => {
  const s = freshStore()
  const m = scheduleMaintenance(s, { title: 'X', components: ['api'], impact: 'i', body: 'b', starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z' }, NOW)
  const during = new Date('2026-09-25T10:50:00Z')
  m.state = 'in_progress'; m.sent.end_nag = '2026-09-25T10:50:00Z'
  assert.throws(() => extendMaintenance(s, m.id, '2026-09-25T10:30:00Z', during), ValidationError)
  extendMaintenance(s, m.id, '2026-09-25T11:30:00Z', during)
  assert.equal(m.ends_at, '2026-09-25T11:30:00Z')
  assert.equal(m.sent.end_nag, null)
  assert.equal(m.sent.extended.length, 1)
  assert.equal(m.sent.extended[0].emailed, false)

  const m2 = scheduleMaintenance(s, { title: 'Y', components: ['api'], impact: 'i', body: 'b', starts_at: '2026-09-26T10:00:00Z', ends_at: '2026-09-26T11:00:00Z' }, NOW)
  m2.sent.t24h = 'sent'
  assert.throws(() => rescheduleMaintenance(s, m2.id, '2026-09-22T10:00:00Z', '2026-09-22T11:00:00Z', NOW), /48 hours/)
  rescheduleMaintenance(s, m2.id, '2026-09-27T10:00:00Z', '2026-09-27T11:00:00Z', NOW)
  assert.equal(m2.sent.t24h, null)
  assert.equal(m2.sent.rescheduled, 'pending')
  cancelMaintenance(s, m2.id, NOW)
  assert.equal(m2.state, 'cancelled')
  assert.throws(() => cancelMaintenance(s, m2.id, NOW), ValidationError)
})

test('loadStore/saveStore round trip and derive on save', () => {
  const dir = tmpData()
  const s = loadStore(dir)
  openIncident(s, { title: 'A', impact: 'major', components: ['app'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  saveStore(dir, s, NOW)
  const again = loadStore(dir)
  assert.equal(again.incidents.length, 1)
  assert.equal(JSON.parse(readFileSync(join(dir, 'components.json'), 'utf8')).find(c => c.id === 'app').status, 'partial_outage')
})
