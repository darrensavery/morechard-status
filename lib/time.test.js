import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIso, minutesBetween, addMinutes, formatUtc, isoNow } from './time.js'

test('parseIso rejects garbage', () => {
  assert.throws(() => parseIso('not a date'))
  assert.throws(() => parseIso(undefined))
})
test('minutesBetween is b minus a', () => {
  assert.equal(minutesBetween(parseIso('2026-09-21T10:00:00Z'), parseIso('2026-09-21T10:45:00Z')), 45)
})
test('addMinutes', () => {
  assert.equal(addMinutes(parseIso('2026-09-21T10:00:00Z'), 30).toISOString(), '2026-09-21T10:30:00.000Z')
})
test('formatUtc is human and UTC', () => {
  assert.equal(formatUtc('2026-09-21T20:30:00Z'), '21 Sep 2026, 20:30 UTC')
})
test('isoNow strips milliseconds', () => {
  assert.equal(isoNow(new Date('2026-09-21T20:30:00.123Z')), '2026-09-21T20:30:00Z')
})
