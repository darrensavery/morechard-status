import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPost, flushEmails, runTick, shouldEmailUpdate } from './actions.js'

const NOW = new Date('2026-09-21T19:52:00Z')
function store() { return { components: [{ id: 'api', name: 'API', status: 'operational' }], incidents: [], maintenance: [] } }
function fakeDeps() {
  const sent = [], nags = [], closed = []
  return {
    sent, nags, closed,
    resend: {
      sendBroadcast: async (aud, e) => { sent.push([aud, e.subject]); return 'bc' },
      sendTransactional: async (to, e) => { nags.push([to, e.subject]) },
    },
    audiences: { all: 'AUD_ALL', paying: 'AUD_PAY' },
    operatorEmail: 'ops@x.com',
    formUrl: 'https://gh/form',
    github: { openOrCommentIssue: () => 7, closeIssuesByTitle: t => closed.push(t) },
  }
}
const quiet = () => {}

test('shouldEmailUpdate: first, transitions, resolve; not same-status', () => {
  const u = s => ({ status: s })
  assert.equal(shouldEmailUpdate([u('investigating')], 0), true)
  assert.equal(shouldEmailUpdate([u('investigating'), u('investigating')], 1), false)
  assert.equal(shouldEmailUpdate([u('investigating'), u('identified')], 1), true)
  assert.equal(shouldEmailUpdate([u('monitoring'), u('resolved')], 1), true)
})

test('open incident then flush sends one paying broadcast; second flush sends nothing', async () => {
  const s = store(), d = fakeDeps()
  runPost(s, 'open', { title: 'A', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  await flushEmails(s, d, NOW, quiet)
  assert.deepEqual(d.sent, [['AUD_PAY', 'Morechard: A']])
  assert.equal(s.incidents[0].updates[0].emailed, true)
})

test('same-status update is page only; transition emails; resolve emails and closes nag issue', async () => {
  const s = store(), d = fakeDeps()
  runPost(s, 'open', { title: 'A', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  runPost(s, 'update', { id: '2026-09-21-a', status: 'investigating', body: 'still' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent.length, 1)
  assert.equal(s.incidents[0].updates[1].emailed, true)
  runPost(s, 'update', { id: '2026-09-21-a', status: 'identified', body: 'found' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent.length, 2)
  assert.equal(d.sent[1][1], 'Update: A')
  runPost(s, 'resolve', { id: '2026-09-21-a', body: 'done', summary: 'oops' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent[2][1], 'Resolved: A')
  assert.deepEqual(d.closed, ['Status: update overdue - A'])
})

test('tick nags an overdue incident every 10 min and records it', async () => {
  const s = store(), d = fakeDeps()
  runPost(s, 'open', { title: 'A', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  let r = await runTick(s, d, new Date('2026-09-21T20:10:00Z'), quiet)
  assert.equal(d.nags.length, 0)
  assert.equal(r.changed, false)
  r = await runTick(s, d, new Date('2026-09-21T20:25:00Z'), quiet)
  assert.equal(r.changed, true)
  assert.equal(d.nags.length, 1)
  assert.equal(s.incidents[0].nags[0].issue, 7)
  await runTick(s, d, new Date('2026-09-21T20:30:00Z'), quiet)
  assert.equal(d.nags.length, 1)
  await runTick(s, d, new Date('2026-09-21T20:36:00Z'), quiet)
  assert.equal(d.nags.length, 2)
})

test('maintenance lifecycle across ticks sends each broadcast exactly once', async () => {
  const s = store(), d = fakeDeps()
  runPost(s, 'schedule', { title: 'DB', components: ['api'], impact: 'i', body: 'b', starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  assert.deepEqual(d.sent, [['AUD_ALL', 'Planned maintenance: DB']])
  const tickAt = t => runTick(s, d, new Date(t), quiet)
  await tickAt('2026-09-24T10:05:00Z')
  await tickAt('2026-09-24T10:15:00Z')
  assert.equal(d.sent.length, 2)
  assert.ok(d.sent[1][1].includes('tomorrow'))
  await tickAt('2026-09-25T09:05:00Z')
  assert.equal(d.sent.length, 3)
  assert.ok(d.sent[2][1].includes('hour'))
  await tickAt('2026-09-25T10:05:00Z')
  assert.equal(s.maintenance[0].state, 'in_progress')
  assert.equal(s.components[0].status, 'maintenance')
  assert.equal(d.sent.length, 3)
  await tickAt('2026-09-25T10:52:00Z')
  assert.equal(d.nags.length, 1)
  assert.ok(d.nags[0][1].includes('10 minutes'))
  runPost(s, 'extend', { id: '2026-09-25-db', ends_at: '2026-09-25T11:30:00Z' }, new Date('2026-09-25T10:55:00Z'))
  await flushEmails(s, d, new Date('2026-09-25T10:55:00Z'), quiet)
  assert.equal(d.sent.length, 4)
  assert.ok(d.sent[3][1].includes('longer'))
  await tickAt('2026-09-25T11:05:00Z')
  assert.equal(s.maintenance[0].state, 'in_progress')
  assert.equal(d.nags.length, 1)
  await tickAt('2026-09-25T11:22:00Z')
  assert.equal(d.nags.length, 2)
  await tickAt('2026-09-25T11:31:00Z')
  assert.equal(s.maintenance[0].state, 'complete')
  assert.equal(s.components[0].status, 'operational')
  assert.equal(d.sent[4][1], 'Maintenance complete: DB')
  await tickAt('2026-09-25T11:41:00Z')
  assert.equal(d.sent.length, 5)
})

test('cancel and reschedule each email once', async () => {
  const s = store(), d = fakeDeps()
  runPost(s, 'schedule', { title: 'DB', components: ['api'], impact: 'i', body: 'b', starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  runPost(s, 'reschedule', { id: '2026-09-25-db', starts_at: '2026-09-26T10:00:00Z', ends_at: '2026-09-26T11:00:00Z' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent.length, 2)
  assert.ok(d.sent[1][1].startsWith('New time'))
  runPost(s, 'cancel', { id: '2026-09-25-db' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent.length, 3)
  assert.ok(d.sent[2][1].startsWith('Cancelled'))
})

test('a failed broadcast is retried on the next flush', async () => {
  const s = store(), d = fakeDeps()
  let fail = true
  d.resend.sendBroadcast = async (aud, e) => { if (fail) throw new Error('down'); d.sent.push([aud, e.subject]); return 'bc' }
  runPost(s, 'open', { title: 'A', impact: 'major', components: ['api'], eta: '2026-09-21T20:30:00Z', body: 'x' }, NOW)
  await flushEmails(s, d, NOW, quiet)
  assert.equal(s.incidents[0].updates[0].emailed, false)
  fail = false
  await flushEmails(s, d, NOW, quiet)
  assert.equal(d.sent.length, 1)
})
