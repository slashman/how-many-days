import { execFileSync } from 'node:child_process'

const FIELD = '\u001f'
const RECORD = '\u001e'

/**
 * Run a git command in `cwd` and return its stdout.
 * Throws a plain Error carrying git's stderr so the CLI can print it verbatim.
 */
export function git(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const stderr = (err.stderr || '').trim()
    const e = new Error(stderr || err.message)
    e.code = 'GIT_FAILED'
    throw e
  }
}

export function assertGitRepo(cwd = process.cwd()) {
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd)
  } catch {
    const e = new Error('not a git repository (or any of the parent directories)')
    e.code = 'NOT_A_REPO'
    throw e
  }
}

/** Human-readable name of the ref being counted, e.g. "main" or "HEAD (detached)". */
export function describeRef(ref, cwd = process.cwd()) {
  if (ref !== 'HEAD') return ref
  const name = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()
  return name === 'HEAD' ? 'HEAD (detached)' : name
}

export function currentUserEmail(cwd = process.cwd()) {
  try {
    return git(['config', '--get', 'user.email'], cwd).trim()
  } catch {
    return ''
  }
}

/**
 * Read commits reachable from `ref` (minus `base`, when given).
 * Each commit is { hash, epoch, iso, name, email, subject }.
 */
export function readCommits(opts = {}) {
  const {
    cwd = process.cwd(),
    ref = 'HEAD',
    base = null,
    author = null,
    since = null,
    until = null,
    merges = true,
    passthrough = [],
  } = opts

  const format = ['%H', '%at', '%aI', '%ct', '%cI', '%an', '%ae', '%s'].join(FIELD) + RECORD
  const args = ['log', `--pretty=format:${format}`, ref]
  if (base) args.push('--not', base)
  if (author) args.push(`--author=${author}`)
  if (since) args.push(`--since=${since}`)
  if (until) args.push(`--until=${until}`)
  if (!merges) args.push('--no-merges')
  args.push(...passthrough)

  const stdout = git(args, cwd)
  return stdout
    .split(RECORD)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, at, aIso, ct, cIso, name, email, subject = ''] = record.split(FIELD)
      return {
        hash,
        authorEpoch: Number(at) * 1000,
        authorIso: aIso,
        committerEpoch: Number(ct) * 1000,
        committerIso: cIso,
        name,
        email,
        subject,
      }
    })
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * Bucket a commit into the calendar day it belongs to.
 *
 * `tz: 'author'` uses the timezone the commit was recorded in — the day as the
 * person who wrote it actually lived it. `tz: 'local'` re-projects everything
 * into the timezone of whoever is running the command.
 *
 * `dayStart` shifts the midnight boundary forward, so that with `--day-start 4`
 * a commit at 01:30 still counts as the previous work day.
 */
export function dayOf(commit, { tz = 'author', dayStart = 0, use = 'author' } = {}) {
  const shift = dayStart * 3600 * 1000
  if (tz === 'local') {
    const epoch = use === 'committer' ? commit.committerEpoch : commit.authorEpoch
    // 'sv-SE' renders as YYYY-MM-DD, in the runtime's local timezone.
    return new Date(epoch - shift).toLocaleDateString('sv-SE')
  }
  // The first 19 chars of a strict-ISO date are the wall clock as recorded.
  const iso = use === 'committer' ? commit.committerIso : commit.authorIso
  const [y, mo, d, h, mi, s] = iso.slice(0, 19).split(/[-T:]/).map(Number)
  const shifted = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - shift)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

const DAY_MS = 86400000
const toUTC = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Longest run of consecutive calendar days present in a sorted day list. */
export function longestStreak(days) {
  let best = 0
  let run = 0
  let prev = null
  for (const day of days) {
    const t = toUTC(day)
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1
    if (run > best) best = run
    prev = t
  }
  return best
}

export const PERIOD_UNITS = ['year', 'month', 'week']
export const GROUP_UNITS = [...PERIOD_UNITS, 'author']

/**
 * ISO-8601 week label for a `YYYY-MM-DD` day, e.g. `2026-W32`.
 *
 * The week belongs to whichever year holds its Thursday, so the first days of
 * January can land in the previous year's final week — and the last days of
 * December in the next year's first. Labels built this way still sort
 * chronologically as plain strings.
 */
export function isoWeek(day) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = date.getUTCDay() || 7 // Monday = 1 … Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday) // the Thursday of this week
  const year = date.getUTCFullYear()
  const week = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1
  return `${year}-W${pad(week)}`
}

/** The period a day falls into for `--by year|month|week`. */
export function groupKeyOf(day, by) {
  switch (by) {
    case 'year':
      return day.slice(0, 4)
    case 'month':
      return day.slice(0, 7)
    case 'week':
      return isoWeek(day)
    default:
      throw new Error(`unknown grouping unit "${by}"`)
  }
}

/**
 * Which person a commit belongs to.
 *
 * Keyed on the email so that one contributor spelled three different ways in
 * `user.name` stays one person — the same identity the `authors` count already
 * uses. Names are for display only, and picked in `authorLabels`.
 */
const authorKeyOf = (commit) => commit.email || commit.name

/**
 * A display name per person: whichever spelling of their name they used most.
 *
 * Two people can share a name — a shared machine, a family, a common name — and
 * silently printing one label twice makes them look like a rendering bug. When
 * that happens both get their email appended, and only then, so the common case
 * stays clean.
 */
export function authorLabels(commits) {
  const names = new Map()
  for (const commit of commits) {
    const key = authorKeyOf(commit)
    if (!names.has(key)) names.set(key, new Map())
    const counts = names.get(key)
    counts.set(commit.name, (counts.get(commit.name) ?? 0) + 1)
  }

  const busiest = new Map()
  const seen = new Map()
  for (const [key, counts] of names) {
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    busiest.set(key, name)
    seen.set(name, (seen.get(name) ?? 0) + 1)
  }
  return new Map(
    [...busiest].map(([key, name]) => [key, seen.get(name) > 1 ? `${name} <${key}>` : name])
  )
}

/** The bucket one commit falls into along a single dimension. */
const keyOf = (dimension, day, commit) =>
  dimension === 'author' ? authorKeyOf(commit) : groupKeyOf(day, dimension)

/**
 * Break days down along one or more dimensions, nesting as it goes.
 *
 * `dimensions` is applied outermost-first, so `['year', 'author']` gives a row
 * per year, each carrying a nested `groups` array of the people who worked that
 * year; swapping them inverts the view. Every level reports the same shape, so
 * a consumer can recurse without special-casing depth.
 *
 * Days are counted, not calendar days elapsed — a year with commits on 18 days
 * reports 18 — and buckets with no work are absent rather than zero. Day counts
 * along the author dimension overlap: two people committing on the same day is
 * one day of work, and it belongs to both of them, so those rows sum to more
 * than their parent's total. That is inherent to the question, not a bug.
 *
 * `authors` holds one entry per person, not per spelling of a name, so its
 * length agrees with both the top-level `authors` count and the number of rows
 * an `author` dimension nested underneath would produce.
 *
 * Periods come out chronologically (the input is sorted and every key form is
 * monotonic in date, so insertion order is enough). People come out busiest
 * first, since there is no natural order to fall back on.
 */
export function buildGroups(days, byDay, dimensions, labels) {
  const entries = []
  for (const day of days) {
    for (const commit of byDay.get(day)) entries.push([day, commit])
  }
  return groupEntries(entries, dimensions, labels ?? authorLabels(entries.map(([, c]) => c)))
}

function groupEntries(entries, [dimension, ...rest], labels) {
  const buckets = new Map()
  for (const entry of entries) {
    const [day, commit] = entry
    const key = keyOf(dimension, day, commit)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, first: day, days: new Set(), commits: 0, people: new Set(), entries: [] }
      buckets.set(key, bucket)
    }
    bucket.days.add(day)
    bucket.commits++
    bucket.last = day
    bucket.people.add(authorKeyOf(commit))
    if (rest.length) bucket.entries.push(entry)
  }

  const rows = [...buckets.values()].map((bucket) => ({
    group: dimension === 'author' ? labels.get(bucket.key) : bucket.key,
    days: bucket.days.size,
    commits: bucket.commits,
    first: bucket.first,
    last: bucket.last,
    authors: [...bucket.people].map((key) => labels.get(key)).sort(),
    ...(rest.length ? { groups: groupEntries(bucket.entries, rest, labels) } : {}),
  }))

  if (dimension !== 'author') return rows
  return rows.sort(
    (a, b) => b.days - a.days || b.commits - a.commits || a.group.localeCompare(b.group)
  )
}

/** Group commits into days and derive the summary stats the CLI reports. */
export function summarize(commits, opts = {}) {
  const byDay = new Map()
  for (const commit of commits) {
    const day = dayOf(commit, opts)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(commit)
    else byDay.set(day, [commit])
  }

  const days = [...byDay.keys()].sort()
  const labels = authorLabels(commits)
  const first = days[0] ?? null
  const last = days[days.length - 1] ?? null
  // One dimension or several; a bare string is accepted for convenience.
  const by = opts.by ? [opts.by].flat() : []

  return {
    days: days.length,
    commits: commits.length,
    authors: labels.size,
    first,
    last,
    spanDays: first && last ? Math.round((toUTC(last) - toUTC(first)) / DAY_MS) + 1 : 0,
    longestStreak: longestStreak(days),
    ...(by.length ? { by, groups: buildGroups(days, byDay, by, labels) } : {}),
    breakdown: days.map((day) => {
      const dayCommits = byDay.get(day)
      return {
        day,
        commits: dayCommits.length,
        authors: [...new Set(dayCommits.map((c) => labels.get(authorKeyOf(c))))].sort(),
      }
    }),
  }
}
