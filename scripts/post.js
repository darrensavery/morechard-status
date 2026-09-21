// Operator CLI. Used by post.yml (the GitHub Actions form) and by hand:
//
//   node scripts/post.js open title="API unavailable" impact=major components=api,app \
//        eta=2026-09-21T20:30:00Z body="We are aware the app is not loading and are investigating."
//   node scripts/post.js update id=<id> status=identified [eta=...] body="..."
//   node scripts/post.js resolve id=<id> body="..." summary="What happened."
//   node scripts/post.js schedule title="Database upgrade" components=api,app \
//        starts_at=2026-10-04T02:00:00Z ends_at=2026-10-04T03:00:00Z impact="..." body="..."
//   node scripts/post.js extend id=<id> ends_at=...
//   node scripts/post.js reschedule id=<id> starts_at=... ends_at=...
//   node scripts/post.js cancel id=<id>
//
// Writes status/data and, when RESEND_API_KEY is set and dry_run is not,
// sends the owed broadcasts. Emails are only ever sent after the data is
// written, so a Resend failure never loses the update (the tick retries).

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { loadStore, saveStore, ValidationError } from '../lib/model.js'
import { runPost, flushEmails } from '../lib/actions.js'
import { ResendClient } from '../lib/email.js'
import * as github from '../lib/github.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'data')

const [cmd, ...rest] = process.argv.slice(2)
const args = {}
for (const kv of rest) {
  const i = kv.indexOf('=')
  if (i < 0) continue
  const v = kv.slice(i + 1)
  if (v !== '') args[kv.slice(0, i)] = v   // the Actions form passes every field, empty ones mean "absent"
}
if (args.components) args.components = args.components.split(',').map(s => s.trim()).filter(Boolean)

const now = new Date()
const store = loadStore(DATA)

try {
  const { record } = runPost(store, cmd, args, now)
  saveStore(DATA, store, now)
  console.log(`[status] ${cmd} ok: ${record.id}`)
} catch (err) {
  if (err instanceof ValidationError) { console.error(`[status] ${err.message}`); process.exit(1) }
  throw err
}

if (!process.env.RESEND_API_KEY || args.dry_run) {
  console.log('[status] emails skipped (no RESEND_API_KEY or dry_run=1)')
  process.exit(0)
}
const audPath = join(DATA, 'audiences.json')
if (!existsSync(audPath)) {
  console.warn('[status] no data/audiences.json yet, emails skipped (run the audience sync first)')
  process.exit(0)
}
const deps = {
  resend: new ResendClient(process.env.RESEND_API_KEY),
  audiences: JSON.parse(readFileSync(audPath, 'utf8')),
  operatorEmail: process.env.STATUS_OPERATOR_EMAIL,
  formUrl: process.env.STATUS_FORM_URL ?? '',
  github,
}
await flushEmails(store, deps, now)
saveStore(DATA, store, now)
