// Renders the static status site from the store. No JS, no analytics, no
// external requests: the page has to load when everything else is broken.

import { formatUtc, parseIso } from './time.js'
import { logoMarkSvg, wordmarkHtml } from './logo.js'

export const SITE = 'https://status.morechard.com'
const SEVERITY = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 }
const LABEL = { operational: 'Operational', maintenance: 'Under maintenance', degraded: 'Degraded', partial_outage: 'Partial outage', major_outage: 'Major outage' }
const OVERALL = { operational: 'All systems operational', maintenance: 'Planned maintenance in progress', degraded: 'Some features degraded', partial_outage: 'Partial outage', major_outage: 'Major outage' }
const STATUS_WORDS = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' }
const STATE_WORDS = { scheduled: 'Scheduled', in_progress: 'In progress', complete: 'Complete', cancelled: 'Cancelled' }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const HISTORY_DAYS = 90

export function overallStatus(components) {
  return components.reduce((worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst), 'operational')
}

const lastAt = i => i.updates[i.updates.length - 1].at
const within24h = (m, now) => parseIso(m.starts_at).getTime() - now.getTime() <= 24 * 3600000

export function buildStatusJson(store, now) {
  return {
    generated_at: now.toISOString(),
    overall: overallStatus(store.components),
    components: store.components.map(c => ({ id: c.id, status: c.status })),
    active_incidents: store.incidents.filter(i => i.status !== 'resolved').map(i => ({
      id: i.id, title: i.title, status: i.status, impact: i.impact, eta: i.eta, updated_at: lastAt(i), url: `${SITE}/incidents/${i.id}.html`,
    })),
    upcoming_maintenance: store.maintenance
      .filter(m => m.state === 'in_progress' || (m.state === 'scheduled' && within24h(m, now)))
      .map(m => ({ id: m.id, title: m.title, starts_at: m.starts_at, ends_at: m.ends_at, state: m.state, url: `${SITE}/maintenance/${m.id}.html` })),
  }
}

function shell(title, body, { refresh = false, depth = 0 } = {}) {
  const base = depth ? '../' : ''
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${refresh ? '<meta http-equiv="refresh" content="120">' : ''}
<meta name="robots" content="noindex"><link rel="icon" href="${base}logo-512.png" type="image/png"><link rel="stylesheet" href="${base}page.css"></head>
<body><header class="top"><a class="brand" href="${base}index.html">${logoMarkSvg(30)}${wordmarkHtml()}</a><span class="sub">Status</span></header>
<main>${body}</main>
<footer><p>Times are shown in UTC. Questions: <a href="mailto:support@morechard.com">support@morechard.com</a></p><p><a href="https://morechard.com">morechard.com</a> &middot; <a href="https://app.morechard.com">Open the app</a></p></footer>
</body></html>`
}

function updatesList(i) {
  const items = [...i.updates].reverse().map(u =>
    `<li><div class="meta"><span class="pill s-${u.status}">${STATUS_WORDS[u.status]}</span> <time>${formatUtc(u.at)}</time>${u.eta ? ` <span class="eta">ETA ${formatUtc(u.eta)}</span>` : ''}</div><p>${esc(u.body)}</p></li>`)
  return `<ol class="updates">${items.join('')}</ol>`
}

function incidentCard(i, base = '') {
  const eta = i.status === 'resolved' ? '' :
    `<p class="eta-line">We expect to restore service by <strong>${formatUtc(i.eta)}</strong>. This is our best estimate and we will update it as we learn more.</p>`
  return `<article class="card incident i-${i.impact}" id="${esc(i.id)}"><h3><a href="${base}incidents/${esc(i.id)}.html">${esc(i.title)}</a></h3>
<p class="meta"><span class="pill s-${i.status}">${STATUS_WORDS[i.status]}</span> Affects: ${i.components.map(esc).join(', ')}</p>${eta}
${i.summary ? `<p class="summary"><strong>What happened:</strong> ${esc(i.summary)}</p>` : ''}${updatesList(i)}</article>`
}

function maintenanceCard(m, base = '') {
  return `<article class="card maintenance m-${m.state}" id="${esc(m.id)}"><h3><a href="${base}maintenance/${esc(m.id)}.html">${esc(m.title)}</a></h3>
<p class="meta"><span class="pill s-${m.state}">${STATE_WORDS[m.state] ?? m.state}</span> ${formatUtc(m.starts_at)} to ${formatUtc(m.ends_at)}</p>
<p><strong>${esc(m.impact)}</strong></p><p>${esc(m.body)}</p><p class="meta">Affects: ${m.components.map(esc).join(', ')}</p></article>`
}

export function renderIndex(store, now) {
  const overall = overallStatus(store.components)
  const active = store.incidents.filter(i => i.status !== 'resolved')
  const upcoming = store.maintenance.filter(m => ['scheduled', 'in_progress'].includes(m.state))
  const cutoff = now.getTime() - HISTORY_DAYS * 86400000
  const history = [
    ...store.incidents.filter(i => i.status === 'resolved' && parseIso(i.resolved_at).getTime() >= cutoff).map(i => ({ at: i.resolved_at, html: incidentCard(i) })),
    ...store.maintenance.filter(m => ['complete', 'cancelled'].includes(m.state) && parseIso(m.ends_at).getTime() >= cutoff).map(m => ({ at: m.ends_at, html: maintenanceCard(m) })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const components = store.components.map(c =>
    `<li class="c-${c.status}"><span class="name">${esc(c.name)}</span><span class="desc">${esc(c.description ?? '')}</span><span class="state">${LABEL[c.status]}</span></li>`).join('')
  const body = `
<section class="banner b-${overall}"><h1>${OVERALL[overall]}</h1><p>Updated ${formatUtc(now.toISOString())}</p></section>
<section class="components"><ul>${components}</ul></section>
${active.length ? `<section><h2>Active incidents</h2>${active.map(i => incidentCard(i)).join('')}</section>` : ''}
${upcoming.length ? `<section><h2>Scheduled maintenance</h2>${upcoming.map(m => maintenanceCard(m)).join('')}</section>` : ''}
<section><h2>Past ${HISTORY_DAYS} days</h2>${history.length ? history.map(h => h.html).join('') : '<p class="muted">No incidents or maintenance in the past 90 days.</p>'}</section>`
  return shell('Morechard Status', body, { refresh: true })
}

export function renderIncidentPage(i) {
  return shell(`${i.title} | Morechard Status`, incidentCard(i, '../'), { refresh: i.status !== 'resolved', depth: 1 })
}

export function renderMaintenancePage(m) {
  return shell(`${m.title} | Morechard Status`, maintenanceCard(m, '../'), { depth: 1 })
}
