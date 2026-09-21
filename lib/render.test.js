import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overallStatus, buildStatusJson, renderIndex, renderIncidentPage, renderMaintenancePage } from './render.js'

const NOW = new Date('2026-09-21T20:00:00Z')
const comps = [
  { id: 'api', name: 'API', description: 'd', status: 'partial_outage' },
  { id: 'app', name: 'App', description: 'd', status: 'operational' },
]
const open = {
  id: '2026-09-21-a', title: 'A <script>', status: 'identified', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z',
  opened_at: '2026-09-21T19:52:00Z', resolved_at: null, summary: null,
  updates: [
    { at: '2026-09-21T19:52:00Z', status: 'investigating', eta: '2026-09-21T20:30:00Z', body: 'one' },
    { at: '2026-09-21T20:05:00Z', status: 'identified', eta: '2026-09-21T20:30:00Z', body: 'two' },
  ],
  nags: [],
}
const old = { ...open, id: '2026-05-01-old', status: 'resolved', opened_at: '2026-05-01T00:00:00Z', resolved_at: '2026-05-01T01:00:00Z', summary: 'old' }
const soon = { id: '2026-09-22-m', title: 'M', state: 'scheduled', starts_at: '2026-09-22T10:00:00Z', ends_at: '2026-09-22T11:00:00Z', components: ['app'], impact: 'i', body: 'b', created_at: 'x', sent: {} }
const far = { ...soon, id: '2026-10-10-m', starts_at: '2026-10-10T10:00:00Z', ends_at: '2026-10-10T11:00:00Z' }
const store = { components: comps, incidents: [open, old], maintenance: [soon, far] }

test('overallStatus is the worst component', () => {
  assert.equal(overallStatus(comps), 'partial_outage')
  assert.equal(overallStatus([{ status: 'operational' }]), 'operational')
})

test('status.json shape', () => {
  const j = buildStatusJson(store, NOW)
  assert.equal(j.overall, 'partial_outage')
  assert.deepEqual(j.components.map(c => c.id), ['api', 'app'])
  assert.equal(j.active_incidents.length, 1)
  assert.equal(j.active_incidents[0].updated_at, '2026-09-21T20:05:00Z')
  assert.equal(j.active_incidents[0].url, 'https://status.morechard.com/incidents/2026-09-21-a.html')
  assert.deepEqual(j.upcoming_maintenance.map(m => m.id), ['2026-09-22-m'])
})

test('index renders active incident, upcoming maintenance, 90-day history, escapes', () => {
  const html = renderIndex(store, NOW)
  assert.ok(html.includes('A &lt;script&gt;'))
  assert.ok(!html.includes('A <script>'))
  assert.ok(html.includes('20:30 UTC'))
  assert.ok(html.includes('2026-10-10-m'))
  assert.ok(!html.includes('2026-05-01-old'))
  assert.ok(html.includes('http-equiv="refresh"'))
  assert.ok(!/<script/i.test(html.replaceAll('A &lt;script&gt;', '')))
  assert.doesNotMatch(html, /[\u2013\u2014]/)
})

test('permalink pages', () => {
  assert.ok(renderIncidentPage(open).includes('two'))
  assert.ok(renderMaintenancePage(soon).includes('22 Sep 2026'))
})
