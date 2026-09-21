# Morechard status

Public status page for [Morechard](https://morechard.com): incidents, scheduled maintenance and customer notifications.

Live at **https://status.morechard.com**, served by GitHub Pages so it stays up when Morechard's own infrastructure (Cloudflare Pages, Workers, D1) is down. The page is static HTML with no JavaScript, no analytics and no external requests.

## How it works

- `data/` holds the records: `components.json`, one JSON file per incident, one per maintenance window. Component status is derived from those, never hand-edited.
- `build.js` renders `dist/` (index, permalinks, `status.json` for the in-app banner).
- `scripts/post.js` is the operator CLI; `.github/workflows/post.yml` wraps it as a form you can run from the GitHub mobile app.
- `.github/workflows/cadence.yml` runs every 10 minutes: nags the operator when an incident update is overdue (30 min while investigating or identified, 60 min while monitoring), sends maintenance reminders at T-24h and T-1h, flips components at the start of a window, nags 10 minutes before the end, and auto-completes.
- `.github/workflows/audience-sync.yml` mirrors parent emails from production into two Resend audiences nightly, so broadcasts never depend on the database being reachable.
- Emails go through Resend Broadcasts: incident emails to paying families, maintenance emails to all families.

Rules the tooling enforces: an incident cannot be opened without an estimated restoration time; maintenance needs at least 48 hours notice; every send is recorded so nothing is sent twice and failed sends retry.

Operator runbook: `docs/dev/status-runbook.md` in the main Morechard repo.

## Development

```
node --test      # 52 tests, zero dependencies
node build.js    # renders dist/
```
