// Mirrors parent emails from a production D1 export into two Resend
// Audiences (all parents, paying parents) so broadcasts never depend on D1
// being reachable at send time. The D1 query itself runs in the workflow via
// wrangler; this module only sees the exported JSON.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export const AUDIENCE_NAMES = { all: 'status-all-parents', paying: 'status-paying-parents' }

export function diffContacts(desired, existing) {
  const want = new Set(desired.map(e => e.toLowerCase()))
  const have = new Map(existing.map(c => [c.email.toLowerCase(), c]))
  // Never re-add someone who unsubscribed: they are still a contact in
  // Resend (unsubscribed=true) so they never appear in `add`.
  const add = [...want].filter(e => !have.has(e))
  const remove = existing.filter(c => !want.has(c.email.toLowerCase())).map(c => ({ id: c.id, email: c.email }))
  return { add, remove }
}

// `wrangler d1 execute --json` emits [{ results: [...] }].
export function parseD1Export(json) {
  const parsed = JSON.parse(json)
  const results = Array.isArray(parsed) ? parsed.flatMap(r => r.results ?? []) : (parsed.results ?? [])
  const all = results.map(r => r.email).filter(Boolean)
  // Guard against a bad query silently emptying both audiences.
  if (all.length === 0) throw new Error('Refusing to sync: D1 export contains zero parents.')
  const paying = results.filter(r => Number(r.has_lifetime_license) === 1).map(r => r.email)
  return { all, paying }
}

export async function ensureAudiences(client, cachePath) {
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'))
  const existing = await client.listAudiences()
  const get = async name => existing.find(a => a.name === name) ?? (await client.createAudience(name))
  const ids = { all: (await get(AUDIENCE_NAMES.all)).id, paying: (await get(AUDIENCE_NAMES.paying)).id }
  writeFileSync(cachePath, JSON.stringify(ids, null, 2) + '\n')
  return ids
}

export async function syncAudience(client, audienceId, desired, log = console.log) {
  const existing = await client.listContacts(audienceId)
  const { add, remove } = diffContacts(desired, existing)
  for (const email of add) await client.createContact(audienceId, email)
  for (const c of remove) await client.removeContact(audienceId, c.id)
  log(`[audience ${audienceId}] existing=${existing.length} added=${add.length} removed=${remove.length}`)
}
