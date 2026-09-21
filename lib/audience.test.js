import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffContacts, parseD1Export, syncAudience } from './audience.js'

test('diffContacts adds missing, removes departed, skips unsubscribed', () => {
  const existing = [
    { id: '1', email: 'A@x.com', unsubscribed: false },
    { id: '2', email: 'gone@x.com', unsubscribed: false },
    { id: '3', email: 'left@x.com', unsubscribed: true },
  ]
  const d = diffContacts(['a@x.com', 'new@x.com', 'left@x.com'], existing)
  assert.deepEqual(d.add, ['new@x.com'])
  assert.deepEqual(d.remove.map(r => r.email), ['gone@x.com'])
})

test('parseD1Export reads wrangler --json shape and rejects empty', () => {
  const rows = parseD1Export(JSON.stringify([{ results: [{ email: 'p@x.com', has_lifetime_license: 1 }, { email: 't@x.com', has_lifetime_license: 0 }] }]))
  assert.deepEqual(rows.all, ['p@x.com', 't@x.com'])
  assert.deepEqual(rows.paying, ['p@x.com'])
  assert.throws(() => parseD1Export(JSON.stringify([{ results: [] }])), /zero parents/)
})

test('syncAudience applies the diff through the client', async () => {
  const calls = []
  const client = {
    listContacts: async () => [{ id: '1', email: 'a@x.com', unsubscribed: false }, { id: '2', email: 'gone@x.com', unsubscribed: false }],
    createContact: async (aud, email) => calls.push(['add', aud, email]),
    removeContact: async (aud, id) => calls.push(['remove', aud, id]),
  }
  await syncAudience(client, 'aud', ['a@x.com', 'new@x.com'], () => {})
  assert.deepEqual(calls, [['add', 'aud', 'new@x.com'], ['remove', 'aud', '2']])
})
