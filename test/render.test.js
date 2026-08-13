import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from '../src/index.js'
import { render, renderGroups } from '../src/render.js'
import { commit, inRepo } from './fixtures.js'

/** The metadata the CLI hands the renderer, for a given set of repo labels. */
const meta = (...repos) => ({
  repos: repos.map((repo) => ({ repo, ref: 'main' })),
  target: repos.join(', '),
  filter: '',
})

const options = (extra = {}) => ({ by: [], list: false, bars: true, ...extra })

/** Two repos, two people, one day worked in both — every column in play at once. */
const MIXED = [
  inRepo('mobile', '2026-03-04T09:00:00+00:00', 'Ada'),
  inRepo('mobile', '2026-03-05T09:00:00+00:00', 'Ada'),
  inRepo('backend', '2026-03-04T14:00:00+00:00', 'Grace'),
  inRepo('backend', '2026-03-06T14:00:00+00:00', 'Grace'),
  inRepo('backend', '2026-03-06T15:00:00+00:00', 'Ada'),
]

const barColumns = (lines) =>
  new Set(lines.filter((line) => line.includes('#')).map((line) => line.indexOf('#')))

test('bars start in the same column on every row, at every depth', () => {
  const stats = summarize(MIXED, { by: ['repo', 'author'] })
  const lines = renderGroups(stats)
  // Author rows drop the authors count, which used to drag their bar left with it.
  assert.equal(lines.filter((line) => line.includes('#')).length, 5)
  assert.deepEqual([...barColumns(lines)], [35])
})

test('bars stay aligned three dimensions deep', () => {
  const stats = summarize(MIXED, { by: ['month', 'repo', 'author'] })
  assert.equal(barColumns(renderGroups(stats)).size, 1)
})

test('the whole table lines up, column for column', () => {
  const stats = summarize(MIXED, { by: ['repo', 'author'] })
  assert.equal(
    renderGroups(stats).join('\n'),
    [
      '           days  commits  authors',
      '  backend     2        3        2  ########################',
      '    Grace     2        2           ########################',
      '    Ada       1        1           ############',
      '  mobile      2        2        1  ########################',
      '    Ada       2        2           ########################',
      '',
      '  4 days listed, 3 distinct — a day worked in two repos counts once, and a day two people both worked counts once.',
    ].join('\n')
  )
})

test('a single-author history keeps the authors column out altogether', () => {
  const stats = summarize([commit('2026-03-04T09:00:00+00:00')], { by: 'year' })
  const [header, row] = renderGroups(stats)
  assert.equal(header, '        days  commits')
  assert.equal(row, '  2026     1        1  ########################')
})

test('--list lines the names and repos up after the bar', () => {
  const stats = summarize(MIXED)
  const rows = render(stats, meta('mobile', 'backend'), options({ list: true }))
    .split('\n')
    .filter((line) => /^ {2}\d{4}-/.test(line))
  // The bar on the 5th is half the width of the others, and the 5th has one
  // author against the others' two: both columns hold regardless.
  assert.deepEqual(rows, [
    '  2026-03-04  2  ########################  Ada, Grace  in backend, mobile',
    '  2026-03-05  1  ############              Ada         in mobile',
    '  2026-03-06  2  ########################  Ada, Grace  in backend',
  ])
  assert.equal(new Set(rows.map((r) => r.indexOf('  in '))).size, 1)
})

test('--no-bars prints the counts alone, with nothing left dangling', () => {
  const stats = summarize(MIXED, { by: ['repo', 'author'] })
  const out = render(stats, meta('mobile', 'backend'), options({ by: stats.by, list: true, bars: false }))
  assert.equal(out.includes('#'), false)
  assert.deepEqual(
    out.split('\n').filter((line) => line !== line.trimEnd()),
    []
  )
  // The reserved-but-empty authors slot goes too, rather than padding the row out.
  assert.ok(out.includes('\n    Grace     2        2\n'))
})

test('bars are there unless asked otherwise', () => {
  const stats = summarize(MIXED, { by: 'repo' })
  const out = render(stats, meta('mobile', 'backend'), options({ by: stats.by, list: true }))
  assert.ok(out.includes('#'))
})
