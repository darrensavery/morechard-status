// Operator nags land as GitHub issues so the GitHub mobile app pushes them
// to a phone. Shells out to `gh`, which reads GH_TOKEN and GITHUB_REPOSITORY
// from the Actions environment.

import { execFileSync } from 'node:child_process'

const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

function openIssuesTitled(title) {
  const list = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${title}" in:title`, '--json', 'number,title']))
  return list.filter(i => i.title === title)
}

export function openOrCommentIssue({ title, body, label = 'status' }) {
  const existing = openIssuesTitled(title)[0]
  if (existing) {
    gh(['issue', 'comment', String(existing.number), '--body', body])
    return existing.number
  }
  const url = gh(['issue', 'create', '--title', title, '--body', body, '--label', label])
  return Number(url.split('/').pop())
}

export function closeIssuesByTitle(title, comment) {
  for (const i of openIssuesTitled(title)) gh(['issue', 'close', String(i.number), '--comment', comment])
}
