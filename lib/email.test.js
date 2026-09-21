import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as E from './email.js'

const inc = {
  id: '2026-09-21-api-unavailable', title: 'API unavailable', status: 'identified', impact: 'major', components: ['api'],
  eta: '2026-09-21T20:30:00Z', summary: 'A bad deploy.',
  updates: [{ at: '2026-09-21T19:52:00Z', status: 'investigating', body: 'Looking.' }, { at: '2026-09-21T20:05:00Z', status: 'identified', body: 'Found it.' }],
}
const m = {
  id: '2026-10-04-database-upgrade', title: 'Database upgrade', starts_at: '2026-10-04T02:00:00Z', ends_at: '2026-10-04T03:00:00Z',
  impact: 'Morechard will be unavailable for up to 60 minutes.', body: 'We are upgrading the database.', components: ['api', 'app'],
}

const builders = [
  ['incidentOpened', () => E.incidentOpened(inc)],
  ['incidentStatusChanged', () => E.incidentStatusChanged(inc)],
  ['incidentResolved', () => E.incidentResolved({ ...inc, status: 'resolved' })],
  ['maintenanceScheduled', () => E.maintenanceScheduled(m)],
  ['maintenanceReminder t24h', () => E.maintenanceReminder(m, 't24h')],
  ['maintenanceReminder t1h', () => E.maintenanceReminder(m, 't1h')],
  ['maintenanceExtended', () => E.maintenanceExtended(m)],
  ['maintenanceComplete', () => E.maintenanceComplete(m)],
  ['maintenanceCancelled', () => E.maintenanceCancelled(m)],
  ['maintenanceRescheduled', () => E.maintenanceRescheduled(m)],
  ['operatorNag incident', () => E.operatorNag({ kind: 'incident', record: inc, formUrl: 'https://github.com/x/actions' })],
  ['operatorNag maintenance_end', () => E.operatorNag({ kind: 'maintenance_end', record: m, formUrl: 'https://github.com/x/actions' })],
]
for (const [name, build] of builders) {
  test(`${name}: has subject, html, text; no dashes; links to status page`, () => {
    const out = build()
    assert.ok(out.subject.length > 5)
    assert.ok(out.html.includes('<html'))
    assert.ok(out.text.length > 20)
    for (const s of [out.subject, out.html, out.text]) assert.doesNotMatch(s, /[\u2013\u2014]/)
    if (!name.startsWith('operatorNag')) {
      assert.ok(out.html.includes('status.morechard.com'))
      assert.ok(out.text.includes('status.morechard.com'))
    }
  })
}

test('incident emails carry the ETA, plainly', () => {
  const out = E.incidentOpened(inc)
  assert.ok(out.text.includes('20:30 UTC'))
  assert.ok(out.text.toLowerCase().includes('best estimate'))
})

test('resolved email carries the summary', () => {
  assert.ok(E.incidentResolved({ ...inc, status: 'resolved' }).text.includes('A bad deploy.'))
})

test('html escapes user text', () => {
  const out = E.incidentOpened({ ...inc, title: '<b>x</b>' })
  assert.ok(!out.html.includes('<b>x</b>'))
  assert.ok(out.html.includes('&lt;b&gt;'))
})

test('ResendClient.sendBroadcast creates then sends', async () => {
  const calls = []
  const fetchImpl = async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => ({ id: 'bc_1' }), text: async () => '' } }
  const c = new E.ResendClient('key', fetchImpl)
  const id = await c.sendBroadcast('aud_1', { subject: 's', html: '<p/>', text: 't' })
  assert.equal(id, 'bc_1')
  assert.equal(calls[0][0], 'https://api.resend.com/broadcasts')
  assert.equal(JSON.parse(calls[0][1].body).audience_id, 'aud_1')
  assert.equal(calls[1][0], 'https://api.resend.com/broadcasts/bc_1/send')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer key')
})

test('ResendClient throws on non-ok', async () => {
  const c = new E.ResendClient('key', async () => ({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }))
  await assert.rejects(() => c.sendTransactional('a@b.c', { subject: 's', html: 'h', text: 't' }), /Resend error 500/)
})
