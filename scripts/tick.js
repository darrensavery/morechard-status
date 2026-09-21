// Cadence tick. Run every 10 minutes by cadence.yml.
// Exit 0 = data changed (workflow commits), 3 = nothing to do, other = error.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { loadStore, saveStore } from '../lib/model.js'
import { runTick } from '../lib/actions.js'
import { ResendClient } from '../lib/email.js'
import * as github from '../lib/github.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'data')
const audPath = join(DATA, 'audiences.json')

if (!existsSync(audPath)) {
  console.log('[status] no data/audiences.json yet, nothing to do (run the audience sync first)')
  process.exit(3)
}

const now = new Date()
const store = loadStore(DATA)
const deps = {
  resend: new ResendClient(process.env.RESEND_API_KEY),
  audiences: JSON.parse(readFileSync(audPath, 'utf8')),
  operatorEmail: process.env.STATUS_OPERATOR_EMAIL,
  formUrl: process.env.STATUS_FORM_URL ?? '',
  github,
}
const { changed } = await runTick(store, deps, now)
if (changed) saveStore(DATA, store, now)
console.log(changed ? '[status] tick: changes written' : '[status] tick: no change')
process.exit(changed ? 0 : 3)
