// Email builders for every status notification, plus a tiny Resend client.
// Copy rules: calm, plain English, short, no jargon, no em or en dashes,
// times in UTC. Layout mirrors worker/src/lib/email.ts so status mail looks
// like the rest of Morechard's mail.

import { formatUtc } from './time.js'

export const SITE = 'https://status.morechard.com'
export const FROM = 'Morechard Status <status@mail.morechard.com>'

export function assertNoDashes(s) {
  if (/[\u2013\u2014]/.test(s)) throw new Error('Copy rule: no em or en dashes.')
  return s
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STATUS_WORDS = {
  investigating: 'We are investigating',
  identified: 'We have found the cause and are fixing it',
  monitoring: 'A fix is in place and we are monitoring',
  resolved: 'Resolved',
}
const IMPACT_WORDS = {
  minor: 'Some features are slower or unreliable',
  major: 'Some families cannot use Morechard',
  critical: 'Morechard is unavailable',
}

function layout(title, paragraphs, cta) {
  const ps = paragraphs.map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1c1c1a">${p}</p>`).join('')
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:system-ui,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 16px"><tr><td align="center">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
<tr><td style="background:#0f6b4f;padding:24px 32px;color:#ffffff;font-size:20px;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding:32px">${ps}
<p style="margin:24px 0 0"><a href="${cta.url}" style="display:inline-block;background:#00959c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${esc(cta.label)}</a></p>
<p style="margin:24px 0 0;font-size:13px;color:#6b6a66">You are receiving this because you have a Morechard account. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#6b6a66">Unsubscribe from status emails</a>.</p>
</td></tr></table></td></tr></table></body></html>`
  const text = [title, '', ...paragraphs.map(p => p.replace(/<[^>]+>/g, '')), '', `${cta.label}: ${cta.url}`].join('\n')
  return { html, text }
}

function make(subject, title, paragraphs, cta) {
  assertNoDashes(subject)
  paragraphs.forEach(assertNoDashes)
  return { subject, ...layout(title, paragraphs, cta) }
}

const incUrl = i => `${SITE}/incidents/${i.id}.html`
const mtUrl = m => `${SITE}/maintenance/${m.id}.html`
const etaLine = i => `We expect to restore service by <strong>${formatUtc(i.eta)}</strong>. This is our best estimate and we will update it as we learn more.`
const lastUpdate = i => esc(i.updates[i.updates.length - 1].body)
const safeData = 'Chores, balances and history are stored safely and are not affected unless we say otherwise.'
const windowLine = m => `<strong>${formatUtc(m.starts_at)}</strong> to <strong>${formatUtc(m.ends_at)}</strong>`

// ── Incidents (to paying parents) ────────────────────────────────────────────

export function incidentOpened(i) {
  return make(`Morechard: ${i.title}`, i.title, [
    `${esc(IMPACT_WORDS[i.impact])}. ${esc(STATUS_WORDS[i.status])}.`,
    lastUpdate(i),
    etaLine(i),
    safeData,
  ], { label: 'View live status', url: incUrl(i) })
}

export function incidentStatusChanged(i) {
  return make(`Update: ${i.title}`, i.title, [
    `<strong>${esc(STATUS_WORDS[i.status])}.</strong>`,
    lastUpdate(i),
    etaLine(i),
    safeData,
  ], { label: 'View live status', url: incUrl(i) })
}

export function incidentResolved(i) {
  return make(`Resolved: ${i.title}`, `Resolved: ${i.title}`, [
    'This is fixed and Morechard is working normally again.',
    `What happened: ${esc(i.summary)}`,
    lastUpdate(i),
    'Thank you for your patience.',
  ], { label: 'View incident history', url: incUrl(i) })
}

// ── Maintenance (to all parents) ─────────────────────────────────────────────

export function maintenanceScheduled(m) {
  return make(`Planned maintenance: ${m.title}`, `Planned maintenance: ${m.title}`, [
    `We will be doing some planned work on ${windowLine(m)}.`,
    esc(m.impact),
    esc(m.body),
    'We will remind you a day before and an hour before.',
  ], { label: 'See details', url: mtUrl(m) })
}

export function maintenanceReminder(m, kind) {
  const when = kind === 't24h' ? 'tomorrow' : 'in about an hour'
  return make(`Reminder: planned maintenance ${when}`, `Maintenance ${when}: ${m.title}`, [
    `A reminder that planned work starts ${when}, ${windowLine(m)}.`,
    esc(m.impact),
    'No action is needed.',
  ], { label: 'See details', url: mtUrl(m) })
}

export function maintenanceExtended(m) {
  return make(`Maintenance running longer: ${m.title}`, `Running longer: ${m.title}`, [
    `Our planned work is taking longer than expected. We now expect to finish by <strong>${formatUtc(m.ends_at)}</strong>.`,
    'We are sorry for the extra wait and will confirm when everything is back.',
  ], { label: 'See details', url: mtUrl(m) })
}

export function maintenanceComplete(m) {
  return make(`Maintenance complete: ${m.title}`, `Complete: ${m.title}`, [
    'Our planned work is finished and Morechard is working normally.',
    'Thank you for your patience.',
  ], { label: 'View status page', url: SITE })
}

export function maintenanceCancelled(m) {
  return make(`Cancelled: planned maintenance ${m.title}`, `Cancelled: ${m.title}`, [
    `The planned work on ${windowLine(m)} will no longer take place. Morechard will stay available as normal.`,
  ], { label: 'View status page', url: SITE })
}

export function maintenanceRescheduled(m) {
  return make(`New time: planned maintenance ${m.title}`, `New time: ${m.title}`, [
    `The planned work has moved to ${windowLine(m)}.`,
    esc(m.impact),
    'We will remind you a day before and an hour before.',
  ], { label: 'See details', url: mtUrl(m) })
}

// ── Operator nags (transactional, to STATUS_OPERATOR_EMAIL) ──────────────────

export function operatorNag({ kind, record, formUrl }) {
  if (kind === 'incident') {
    return make(`[Status] Update overdue: ${record.title}`, 'Update overdue', [
      `Incident <strong>${esc(record.title)}</strong> is <strong>${esc(record.status)}</strong> and has not been updated within its cadence. Post an update now, even if it is only a new ETA.`,
      `Current ETA: ${formatUtc(record.eta)}.`,
    ], { label: 'Post an update', url: formUrl })
  }
  return make(`[Status] Maintenance ends in 10 minutes: ${record.title}`, 'Maintenance ending soon', [
    `<strong>${esc(record.title)}</strong> ends at ${formatUtc(record.ends_at)}. Extend it now if work is still running, otherwise it will be marked complete automatically.`,
  ], { label: 'Extend the window', url: formUrl })
}

// ── Resend client ────────────────────────────────────────────────────────────

export class ResendClient {
  constructor(apiKey, fetchImpl = globalThis.fetch) {
    this.apiKey = apiKey
    this.fetch = fetchImpl
  }

  async req(method, path, body) {
    const res = await this.fetch(`https://api.resend.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text().catch(() => '')}`)
    return res.json()
  }

  async sendBroadcast(audienceId, { subject, html, text }) {
    const { id } = await this.req('POST', '/broadcasts', { audience_id: audienceId, from: FROM, subject, html, text })
    await this.req('POST', `/broadcasts/${id}/send`, {})
    return id
  }

  sendTransactional(to, { subject, html, text }) {
    return this.req('POST', '/emails', { from: FROM, to: [to], subject, html, text })
  }

  listAudiences() {
    return this.req('GET', '/audiences').then(r => r.data ?? [])
  }

  createAudience(name) {
    return this.req('POST', '/audiences', { name })
  }

  async listContacts(audienceId) {
    const r = await this.req('GET', `/audiences/${audienceId}/contacts`)
    return (r.data ?? []).map(c => ({ id: c.id, email: c.email, unsubscribed: !!c.unsubscribed }))
  }

  createContact(audienceId, email) {
    return this.req('POST', `/audiences/${audienceId}/contacts`, { email, unsubscribed: false })
  }

  removeContact(audienceId, contactId) {
    return this.req('DELETE', `/audiences/${audienceId}/contacts/${contactId}`)
  }
}
