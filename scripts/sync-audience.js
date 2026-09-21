// usage: node scripts/sync-audience.js <d1-export.json>
// Run nightly by status-audience-sync.yml. Needs RESEND_API_KEY.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ResendClient } from '../lib/email.js'
import { parseD1Export, ensureAudiences, syncAudience } from '../lib/audience.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2]
if (!file) { console.error('usage: sync-audience.js <d1-export.json>'); process.exit(2) }
if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY is not set'); process.exit(2) }

const rows = parseD1Export(readFileSync(file, 'utf8'))
console.log(`[status] D1 export: ${rows.all.length} parents, ${rows.paying.length} paying`)
const client = new ResendClient(process.env.RESEND_API_KEY)
const ids = await ensureAudiences(client, join(ROOT, 'data', 'audiences.json'))
await syncAudience(client, ids.all, rows.all)
await syncAudience(client, ids.paying, rows.paying)
