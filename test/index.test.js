import test from 'node:test'
import assert from 'node:assert/strict'
import { dayOf, longestStreak, summarize } from '../src/index.js'

const commit = (iso, name = 'Ada') => ({
  hash: iso,
  authorEpoch: Date.parse(iso),
  authorIso: iso,
  committerEpoch: Date.parse(iso),
  committerIso: iso,
  name,
  email: `${name.toLowerCase()}@example.com`,
  subject: 'work',
})

test('buckets by the timezone the commit was recorded in', () => {
  // 23:30 in +02:00 is still the 9th where the author sat, though it is the
  // 8th in UTC.
  assert.equal(dayOf(commit('2026-08-09T23:30:00+02:00')), '2026-08-09')
})

test('--tz local re-projects into the runtime timezone', () => {
  process.env.TZ = 'UTC'
  assert.equal(dayOf(commit('2026-08-09T00:30:00+02:00'), { tz: 'local' }), '2026-08-08')
})

test('day-start pushes after-midnight commits onto the previous day', () => {
  const late = commit('2026-08-10T01:30:00+00:00')
  assert.equal(dayOf(late), '2026-08-10')
  assert.equal(dayOf(late, { dayStart: 5 }), '2026-08-09')
  assert.equal(dayOf(commit('2026-08-10T06:00:00+00:00'), { dayStart: 5 }), '2026-08-10')
})

test('counts distinct days, not commits', () => {
  const stats = summarize([
    commit('2026-08-09T09:00:00+00:00'),
    commit('2026-08-09T17:00:00+00:00'),
    commit('2026-08-11T10:00:00+00:00'),
  ])
  assert.equal(stats.days, 2)
  assert.equal(stats.commits, 3)
  assert.equal(stats.first, '2026-08-09')
  assert.equal(stats.last, '2026-08-11')
  assert.equal(stats.spanDays, 3)
  assert.deepEqual(
    stats.breakdown.map((d) => [d.day, d.commits]),
    [
      ['2026-08-09', 2],
      ['2026-08-11', 1],
    ]
  )
})

test('summarizes an empty history without throwing', () => {
  const stats = summarize([])
  assert.deepEqual(
    { days: stats.days, first: stats.first, span: stats.spanDays },
    { days: 0, first: null, span: 0 }
  )
})

test('counts distinct authors', () => {
  const stats = summarize([
    commit('2026-08-09T09:00:00+00:00', 'Ada'),
    commit('2026-08-09T10:00:00+00:00', 'Grace'),
  ])
  assert.equal(stats.authors, 2)
  assert.deepEqual(stats.breakdown[0].authors, ['Ada', 'Grace'])
})

test('longest streak spans month boundaries', () => {
  assert.equal(longestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-03']), 3)
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak(['2026-01-01']), 1)
})
