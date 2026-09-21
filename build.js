// Renders dist/ from data/. Run by deploy.yml, which
// publishes dist/ to GitHub Pages at status.morechard.com.

import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStore } from './lib/model.js'
import { buildStatusJson, renderIndex, renderIncidentPage, renderMaintenancePage } from './lib/render.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DATA = join(ROOT, 'data')
const DIST = join(ROOT, 'dist')

const now = new Date()
const store = loadStore(DATA)

rmSync(DIST, { recursive: true, force: true })
mkdirSync(join(DIST, 'incidents'), { recursive: true })
mkdirSync(join(DIST, 'maintenance'), { recursive: true })

writeFileSync(join(DIST, 'index.html'), renderIndex(store, now))
writeFileSync(join(DIST, 'status.json'), JSON.stringify(buildStatusJson(store, now), null, 2))
for (const i of store.incidents) writeFileSync(join(DIST, 'incidents', `${i.id}.html`), renderIncidentPage(i))
for (const m of store.maintenance) writeFileSync(join(DIST, 'maintenance', `${m.id}.html`), renderMaintenancePage(m))
copyFileSync(join(ROOT, 'templates', 'page.css'), join(DIST, 'page.css'))
mkdirSync(join(DIST, 'fonts'), { recursive: true })
copyFileSync(join(ROOT, 'templates', 'fonts', 'dmsans-latin.woff2'), join(DIST, 'fonts', 'dmsans-latin.woff2'))
copyFileSync(join(ROOT, 'templates', 'logo-512.png'), join(DIST, 'logo-512.png'))
// Custom domain for GitHub Pages; .nojekyll stops Pages ignoring dotfiles/underscores.
writeFileSync(join(DIST, 'CNAME'), 'status.morechard.com\n')
writeFileSync(join(DIST, '.nojekyll'), '')

console.log(`[status] built ${store.incidents.length} incidents, ${store.maintenance.length} maintenance windows`)
