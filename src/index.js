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
  const authors = new Set(commits.map((c) => c.email || c.name))
  const first = days[0] ?? null
  const last = days[days.length - 1] ?? null

  return {
    days: days.length,
    commits: commits.length,
    authors: authors.size,
    first,
    last,
    spanDays: first && last ? Math.round((toUTC(last) - toUTC(first)) / DAY_MS) + 1 : 0,
    longestStreak: longestStreak(days),
    breakdown: days.map((day) => {
      const dayCommits = byDay.get(day)
      return {
        day,
        commits: dayCommits.length,
        authors: [...new Set(dayCommits.map((c) => c.name))].sort(),
      }
    }),
  }
}
