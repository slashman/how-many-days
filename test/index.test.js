import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authorLabels,
  dayOf,
  groupKeyOf,
  isoWeek,
  longestStreak,
  resolveRepos,
  summarize,
} from '../src/index.js'

const commit = (iso, name = 'Ada', email = `${name.toLowerCase()}@example.com`) => ({
  hash: iso,
  authorEpoch: Date.parse(iso),
  authorIso: iso,
  committerEpoch: Date.parse(iso),
  committerIso: iso,
  name,
  email,
  subject: 'work',
})

/** A commit as readRepoCommits hands it over: tagged with the repo it came from. */
const inRepo = (repo, iso, name) => ({ ...commit(iso, name), repo })

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

test('--by rolls days up into periods, counting days and not span', () => {
  const stats = summarize(
    [
      commit('2025-11-30T09:00:00+00:00'),
      commit('2026-03-04T09:00:00+00:00'),
      commit('2026-03-04T18:00:00+00:00'),
      commit('2026-03-09T09:00:00+00:00'),
      commit('2026-08-09T09:00:00+00:00'),
    ],
    { by: 'year' }
  )
  assert.deepEqual(stats.by, ['year'])
  assert.deepEqual(
    stats.groups.map((g) => [g.group, g.days, g.commits, g.first, g.last]),
    [
      ['2025', 1, 1, '2025-11-30', '2025-11-30'],
      ['2026', 3, 4, '2026-03-04', '2026-08-09'],
    ]
  )
})

test('--by month and week bucket the same days differently', () => {
  const commits = [
    commit('2026-03-04T09:00:00+00:00'),
    commit('2026-03-09T09:00:00+00:00'),
    commit('2026-03-10T09:00:00+00:00'),
  ]
  assert.deepEqual(
    summarize(commits, { by: 'month' }).groups.map((g) => [g.group, g.days]),
    [['2026-03', 3]]
  )
  assert.deepEqual(
    summarize(commits, { by: 'week' }).groups.map((g) => [g.group, g.days]),
    [
      ['2026-W10', 1],
      ['2026-W11', 2],
    ]
  )
})

test('groups carry the authors who worked in each period', () => {
  const stats = summarize(
    [
      commit('2026-03-04T09:00:00+00:00', 'Ada'),
      commit('2026-03-04T10:00:00+00:00', 'Grace'),
      commit('2026-04-04T10:00:00+00:00', 'Grace'),
    ],
    { by: 'month' }
  )
  assert.deepEqual(
    stats.groups.map((g) => g.authors),
    [['Ada', 'Grace'], ['Grace']]
  )
})

test('omits grouping entirely unless asked for', () => {
  const stats = summarize([commit('2026-03-04T09:00:00+00:00')])
  assert.equal('groups' in stats, false)
  assert.equal('by' in stats, false)
})

test('--by author counts each person’s own days', () => {
  const stats = summarize(
    [
      commit('2026-03-04T09:00:00+00:00', 'Ada'),
      commit('2026-03-04T10:00:00+00:00', 'Grace'),
      commit('2026-03-05T10:00:00+00:00', 'Grace'),
      commit('2026-03-06T10:00:00+00:00', 'Grace'),
    ],
    { by: 'author' }
  )
  // Busiest first, and the shared 4th counts for both — 4 listed against 3 real.
  assert.deepEqual(
    stats.groups.map((g) => [g.group, g.days, g.commits]),
    [
      ['Grace', 3, 3],
      ['Ada', 1, 1],
    ]
  )
  assert.equal(stats.days, 3)
  assert.equal(
    stats.groups.reduce((sum, g) => sum + g.days, 0),
    4
  )
})

test('dimensions nest, outermost first, and invert when swapped', () => {
  const commits = [
    commit('2025-12-02T09:00:00+00:00', 'Ada'),
    commit('2026-03-04T09:00:00+00:00', 'Ada'),
    commit('2026-03-04T10:00:00+00:00', 'Grace'),
    commit('2026-03-05T10:00:00+00:00', 'Grace'),
  ]

  const byYear = summarize(commits, { by: ['year', 'author'] })
  assert.deepEqual(byYear.by, ['year', 'author'])
  assert.deepEqual(
    byYear.groups.map((g) => [g.group, g.days, g.groups.map((c) => [c.group, c.days])]),
    [
      ['2025', 1, [['Ada', 1]]],
      [
        '2026',
        2,
        [
          ['Grace', 2],
          ['Ada', 1],
        ],
      ],
    ]
  )

  const byAuthor = summarize(commits, { by: ['author', 'year'] })
  assert.deepEqual(
    byAuthor.groups.map((g) => [g.group, g.days, g.groups.map((c) => [c.group, c.days])]),
    [
      [
        'Ada',
        2,
        [
          ['2025', 1],
          ['2026', 1],
        ],
      ],
      ['Grace', 2, [['2026', 2]]],
    ]
  )
})

test('one person spelled several ways stays one person', () => {
  const commits = [
    commit('2026-03-04T09:00:00+00:00', 'Ada Lovelace', 'ada@example.com'),
    commit('2026-03-05T09:00:00+00:00', 'ada', 'ada@example.com'),
    commit('2026-03-06T09:00:00+00:00', 'ada', 'ada@example.com'),
  ]
  const stats = summarize(commits, { by: 'author' })
  assert.equal(stats.authors, 1)
  // Labelled with the spelling used most, not the first one seen.
  assert.deepEqual(
    stats.groups.map((g) => [g.group, g.days]),
    [['ada', 3]]
  )
})

test('two people sharing a name are told apart by email', () => {
  const labels = authorLabels([
    commit('2026-03-04T09:00:00+00:00', 'Alex', 'alex@one.com'),
    commit('2026-03-05T09:00:00+00:00', 'Alex', 'alex@two.com'),
    commit('2026-03-06T09:00:00+00:00', 'Ada', 'ada@example.com'),
  ])
  assert.deepEqual(
    [...labels.values()].sort(),
    ['Ada', 'Alex <alex@one.com>', 'Alex <alex@two.com>']
  )
})

test('the authors count agrees with the rows an author dimension yields', () => {
  const commits = [
    commit('2026-03-04T09:00:00+00:00', 'Ada Lovelace', 'ada@example.com'),
    commit('2026-03-04T10:00:00+00:00', 'ada', 'ada@example.com'),
    commit('2026-03-04T11:00:00+00:00', 'Grace', 'grace@example.com'),
  ]
  const stats = summarize(commits, { by: ['year', 'author'] })
  const [year] = stats.groups
  // Two identities, three name spellings: the count follows identities.
  assert.equal(stats.authors, 2)
  assert.equal(year.authors.length, 2)
  assert.equal(year.groups.length, 2)
  assert.deepEqual(stats.breakdown[0].authors, ['Grace', 'ada'])
})

test('a day worked in two repos is one day of work', () => {
  const stats = summarize([
    inRepo('mobile', '2026-03-04T09:00:00+00:00'),
    inRepo('backend', '2026-03-04T14:00:00+00:00'),
    inRepo('backend', '2026-03-05T14:00:00+00:00'),
  ])
  assert.equal(stats.days, 2)
  assert.equal(stats.commits, 3)
  assert.deepEqual(stats.breakdown[0], {
    day: '2026-03-04',
    commits: 2,
    authors: ['Ada'],
    repos: ['backend', 'mobile'],
  })
})

test('streaks close over repos, so alternating days are one run', () => {
  const stats = summarize([
    inRepo('mobile', '2026-03-04T09:00:00+00:00'),
    inRepo('backend', '2026-03-05T09:00:00+00:00'),
    inRepo('mobile', '2026-03-06T09:00:00+00:00'),
  ])
  assert.equal(stats.longestStreak, 3)
})

test('--by repo counts each repo’s own days, busiest first', () => {
  const stats = summarize(
    [
      inRepo('mobile', '2026-03-04T09:00:00+00:00'),
      inRepo('backend', '2026-03-04T14:00:00+00:00'),
      inRepo('backend', '2026-03-05T14:00:00+00:00'),
    ],
    { by: 'repo' }
  )
  assert.deepEqual(
    stats.groups.map((g) => [g.group, g.days, g.commits]),
    [
      ['backend', 2, 2],
      ['mobile', 1, 1],
    ]
  )
  // The shared 4th belongs to both repos, so the rows sum past the real total.
  assert.equal(stats.days, 2)
  assert.equal(
    stats.groups.reduce((sum, g) => sum + g.days, 0),
    3
  )
})

test('repo nests with periods and people, in either order', () => {
  const commits = [
    inRepo('mobile', '2025-12-02T09:00:00+00:00', 'Ada'),
    inRepo('mobile', '2026-03-04T09:00:00+00:00', 'Ada'),
    inRepo('backend', '2026-03-04T10:00:00+00:00', 'Grace'),
  ]

  const byYear = summarize(commits, { by: ['year', 'repo'] })
  assert.deepEqual(
    byYear.groups.map((g) => [g.group, g.days, g.groups.map((r) => [r.group, r.days])]),
    [
      ['2025', 1, [['mobile', 1]]],
      [
        '2026',
        1,
        [
          ['backend', 1],
          ['mobile', 1],
        ],
      ],
    ]
  )

  const byRepo = summarize(commits, { by: ['repo', 'author'] })
  assert.deepEqual(
    byRepo.groups.map((g) => [g.group, g.days, g.groups.map((a) => [a.group, a.days])]),
    [
      ['mobile', 2, [['Ada', 2]]],
      ['backend', 1, [['Grace', 1]]],
    ]
  )
})

test('untagged commits carry no repo breakdown', () => {
  const stats = summarize([commit('2026-03-04T09:00:00+00:00')])
  assert.equal('repos' in stats.breakdown[0], false)
})

test('repos are labelled by directory name, and by path when those collide', () => {
  assert.deepEqual(
    resolveRepos(['product-mobile', '../work/product-backend'], '/home/ada/src').map((r) => [
      r.label,
      r.path,
    ]),
    [
      ['product-mobile', '/home/ada/src/product-mobile'],
      ['product-backend', '/home/ada/work/product-backend'],
    ]
  )
  // Two repos both called "api" would print as one row twice over.
  assert.deepEqual(
    resolveRepos(['mobile/api', 'web/api'], '/home/ada').map((r) => r.label),
    ['mobile/api', 'web/api']
  )
})

test('the same repo named twice is counted once', () => {
  const repos = resolveRepos(['mobile', './mobile', '../ada/mobile'], '/home/ada')
  assert.deepEqual(
    repos.map((r) => r.path),
    ['/home/ada/mobile']
  )
})

test('ISO weeks belong to the year holding their Thursday', () => {
  // 2026-01-01 is a Thursday, so it opens 2026-W01 …
  assert.equal(isoWeek('2026-01-01'), '2026-W01')
  // … and the Monday before it belongs to that same week, in the old year.
  assert.equal(isoWeek('2025-12-29'), '2026-W01')
  // 2027-01-01 is a Friday, so it closes out 2026's final week.
  assert.equal(isoWeek('2027-01-01'), '2026-W53')
  assert.equal(isoWeek('2026-08-09'), '2026-W32') // a Sunday, not W33
  assert.equal(isoWeek('2026-08-10'), '2026-W33')
})

test('week labels sort chronologically as plain strings', () => {
  const days = ['2025-12-28', '2025-12-29', '2026-01-05']
  const keys = days.map((d) => groupKeyOf(d, 'week'))
  assert.deepEqual(keys, ['2025-W52', '2026-W01', '2026-W02'])
  assert.deepEqual([...keys].sort(), keys)
})

test('rejects an unknown grouping unit', () => {
  assert.throws(() => groupKeyOf('2026-03-04', 'fortnight'), /fortnight/)
})

test('longest streak spans month boundaries', () => {
  assert.equal(longestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-03']), 3)
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak(['2026-01-01']), 1)
})
