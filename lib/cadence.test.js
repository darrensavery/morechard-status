import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overdueIncidents, dueMaintenanceActions } from './cadence.js'

const at = s => new Date(s)
function inc(status, lastUpdateAt, nags = []) {
  return { id: 'i', status, updates: [{ at: lastUpdateAt }], nags }
}

test('overdue by status', () => {
  assert.equal(overdueIncidents([inc('investigating', '2026-09-21T10:00:00Z')], at('2026-09-21T10:29:00Z')).length, 0)
  assert.equal(overdueIncidents([inc('investigating', '2026-09-21T10:00:00Z')], at('2026-09-21T10:31:00Z')).length, 1)
  assert.equal(overdueIncidents([inc('monitoring', '2026-09-21T10:00:00Z')], at('2026-09-21T10:45:00Z')).length, 0)
  assert.equal(overdueIncidents([inc('monitoring', '2026-09-21T10:00:00Z')], at('2026-09-21T11:01:00Z')).length, 1)
  assert.equal(overdueIncidents([inc('resolved', '2026-09-21T10:00:00Z')], at('2026-09-21T13:00:00Z')).length, 0)
})

test('overdue nags repeat every 10 minutes, not every tick', () => {
  const i = inc('identified', '2026-09-21T10:00:00Z', [{ at: '2026-09-21T10:35:00Z', issue: 1 }])
  assert.equal(overdueIncidents([i], at('2026-09-21T10:40:00Z')).length, 0)
  assert.equal(overdueIncidents([i], at('2026-09-21T10:45:00Z')).length, 1)
})

function mt(over = {}) {
  return {
    id: 'm', state: 'scheduled', starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z',
    sent: { scheduled: 'x', t24h: null, t1h: null, started: null, end_nag: null, complete: null, cancelled: null, extended: [] },
    ...over,
  }
}
const types = (m, t) => dueMaintenanceActions([m], at(t)).map(a => a.type)

test('reminders fire in their window and only once', () => {
  assert.deepEqual(types(mt(), '2026-09-24T09:59:00Z'), [])
  assert.deepEqual(types(mt(), '2026-09-24T10:00:00Z'), ['t24h'])
  assert.deepEqual(types(mt({ sent: { ...mt().sent, t24h: 'x' } }), '2026-09-24T10:10:00Z'), [])
  assert.deepEqual(types(mt({ sent: { ...mt().sent, t24h: 'x' } }), '2026-09-25T09:00:00Z'), ['t1h'])
})

test('inside the last hour with nothing sent, only t1h fires', () => {
  assert.deepEqual(types(mt(), '2026-09-25T09:30:00Z'), ['t1h'])
})

test('start, end nag, complete', () => {
  assert.deepEqual(types(mt({ sent: { ...mt().sent, t24h: 'x', t1h: 'x' } }), '2026-09-25T10:00:00Z'), ['start'])
  const running = mt({ state: 'in_progress', sent: { ...mt().sent, t24h: 'x', t1h: 'x', started: 'x' } })
  assert.deepEqual(types(running, '2026-09-25T10:49:00Z'), [])
  assert.deepEqual(types(running, '2026-09-25T10:50:00Z'), ['end_nag'])
  assert.deepEqual(types({ ...running, sent: { ...running.sent, end_nag: 'x' } }, '2026-09-25T10:55:00Z'), [])
  assert.deepEqual(types(running, '2026-09-25T11:00:00Z'), ['complete'])
})

test('a scheduled window whose start is already past just starts, reminders skipped', () => {
  assert.deepEqual(types(mt(), '2026-09-25T10:05:00Z'), ['start'])
})

test('cancelled and complete windows produce nothing', () => {
  assert.deepEqual(types(mt({ state: 'cancelled' }), '2026-09-25T10:05:00Z'), [])
  assert.deepEqual(types(mt({ state: 'complete' }), '2026-09-25T12:00:00Z'), [])
})
