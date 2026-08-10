#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  GROUP_UNITS,
  PERIOD_UNITS,
  assertGitRepo,
  currentUserEmail,
  describeRef,
  readCommits,
  summarize,
} from '../src/index.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
)

const HELP = `
how-many-days — count the distinct days of work registered in a git branch

Usage
  how-many-days [options] [-- <git log args>]

Options
  -l, --list              show a per-day breakdown
      --by <dimension>    break the days down by year, month, week (ISO weeks)
                          or author. Repeat it to nest one dimension inside
                          another, outermost first: --by year --by author is a
                          row per year with its people underneath, and
                          --by author --by year inverts that
  -j, --json              print machine-readable JSON
  -m, --me                only your own commits (git config user.email)
  -a, --author <pattern>  only commits matching an author pattern
  -s, --since <date>      only commits after a date ("2 weeks ago", 2026-01-01)
  -u, --until <date>      only commits before a date
  -b, --branch <ref>      branch or ref to inspect (default: HEAD)
      --base <ref>        count only commits not already in <ref>, e.g. main
      --tz author|local   bucket by the commit's own timezone or yours
                          (default: author)
      --day-start <h>     hour that starts a work day, so a 01:30 commit still
                          counts as the previous day (default: 0)
      --committer         use committer dates instead of author dates
      --no-merges         ignore merge commits
  -h, --help              show this help
  -V, --version           show version

Anything after -- is passed straight to git log.

Examples
  how-many-days                          days of work on the current branch
  how-many-days --me --list              only my days, with a breakdown
  how-many-days --by year                how many days of work each year
  how-many-days --by author              who put in how many days
  how-many-days --by year --by author    each year, broken down by person
  how-many-days --base main              days spent on this branch alone
  how-many-days --day-start 5 --tz local nights count toward the day before
  how-many-days -- --first-parent        forward extra flags to git log
`.trim()

function parseArgs(argv) {
  const opts = {
    list: false,
    by: [],
    json: false,
    me: false,
    author: null,
    since: null,
    until: null,
    ref: 'HEAD',
    base: null,
    tz: 'author',
    dayStart: 0,
    use: 'author',
    merges: true,
    passthrough: [],
  }

  const need = (i, flag) => {
    if (i + 1 >= argv.length) fail(`${flag} needs a value`)
    return argv[i + 1]
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      opts.passthrough = argv.slice(i + 1)
      break
    }
    switch (arg) {
      case '-h':
      case '--help':
        console.log(HELP)
        process.exit(0)
        break
      case '-V':
      case '--version':
        console.log(pkg.version)
        process.exit(0)
        break
      case '-l':
      case '--list':
        opts.list = true
        break
      case '-j':
      case '--json':
        opts.json = true
        break
      case '-m':
      case '--me':
        opts.me = true
        break
      case '--committer':
        opts.use = 'committer'
        break
      case '--no-merges':
        opts.merges = false
        break
      case '-a':
      case '--author':
        opts.author = need(i, arg)
        i++
        break
      case '-s':
      case '--since':
        opts.since = need(i, arg)
        i++
        break
      case '-u':
      case '--until':
        opts.until = need(i, arg)
        i++
        break
      case '-b':
      case '--branch':
        opts.ref = need(i, arg)
        i++
        break
      case '--base':
        opts.base = need(i, arg)
        i++
        break
      case '--by': {
        // Accept both `--by year --by author` and `--by year,author`.
        for (const dimension of need(i, arg).split(',')) {
          if (!GROUP_UNITS.includes(dimension)) {
            fail(`--by must be one of ${GROUP_UNITS.join(', ')}, got "${dimension}"`)
          }
          if (opts.by.includes(dimension)) fail(`--by ${dimension} given twice`)
          const clash = opts.by.find((d) => PERIOD_UNITS.includes(d))
          if (clash && PERIOD_UNITS.includes(dimension)) {
            fail(`--by takes one period at a time, but got both ${clash} and ${dimension}`)
          }
          opts.by.push(dimension)
        }
        i++
        break
      }
      case '--tz': {
        const tz = need(i, arg)
        if (tz !== 'author' && tz !== 'local') fail(`--tz must be "author" or "local", got "${tz}"`)
        opts.tz = tz
        i++
        break
      }
      case '--day-start': {
        const hours = Number(need(i, arg))
        if (!Number.isFinite(hours) || hours < 0 || hours >= 24) {
          fail('--day-start must be an hour between 0 and 23')
        }
        opts.dayStart = hours
        i++
        break
      }
      default:
        if (arg.startsWith('-')) fail(`unknown option "${arg}" (try --help)`)
        // A bare argument is treated as the ref to inspect.
        opts.ref = arg
    }
  }
  return opts
}

function fail(message) {
  console.error(`how-many-days: ${message}`)
  process.exit(1)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const BAR_WIDTH = 24
const bar = (value, max) => '#'.repeat(Math.max(1, Math.round((value / max) * BAR_WIDTH)))

const HEADERS = ['days', 'commits', 'authors']
const INDENT = 2

/**
 * Walk the nested groups into flat rows, each tagged with its depth.
 *
 * The authors count is dropped once the author dimension has been applied at
 * this level or any level above it — the row's person is already named by its
 * own label or its parent's — and on single-author histories, where the column
 * would read 1 all the way down.
 */
function groupRows(groups, dimensions, showAuthors, depth = 0, rows = []) {
  const countAuthors = showAuthors && !dimensions.slice(0, depth + 1).includes('author')
  for (const group of groups) {
    const cells = [group.days, group.commits]
    if (countAuthors) cells.push(group.authors.length)
    rows.push({ depth, label: group.group, days: group.days, cells })
    if (group.groups) groupRows(group.groups, dimensions, showAuthors, depth + 1, rows)
  }
  return rows
}

/** True if any level's day counts sum past what contains them — see buildGroups. */
function overlaps(groups, total) {
  const sum = groups.reduce((acc, g) => acc + g.days, 0)
  if (sum > total) return true
  return groups.some((g) => g.groups && overlaps(g.groups, g.days))
}

/**
 * A breakdown table, one row per period or person that saw any work, nested when
 * more than one dimension was asked for.
 *
 * Column positions are shared across every level, so the numbers line up in one
 * grid however deep the nesting goes, and the bar tracks days rather than
 * commits: the whole point of the tool is days, and a single frantic afternoon
 * should not out-draw a steady fortnight. Bars are scaled against the largest
 * count anywhere in the table, so a nested row reads as a share of its parent.
 *
 * Only counts go in the table. Each group's first and last day are in --json,
 * where nobody has to pay for the width.
 */
function renderGroups(stats) {
  const dimensions = stats.by
  const rows = groupRows(stats.groups, dimensions, stats.authors > 1)
  const maxDays = Math.max(...rows.map((r) => r.days))
  const labelField = Math.max(...rows.map((r) => r.depth * INDENT + r.label.length))
  const widths = HEADERS.map((header, i) =>
    Math.max(
      rows.some((r) => r.cells.length > i) ? header.length : 0,
      ...rows.map((r) => (r.cells.length > i ? String(r.cells[i]).length : 0))
    )
  )
  const line = (indent, label, cells) => {
    const padded = cells.map((cell, i) => `  ${String(cell).padStart(widths[i])}`)
    return `  ${' '.repeat(indent)}${label.padEnd(labelField - indent)}${padded.join('')}`
  }

  const headers = HEADERS.filter((_, i) => widths[i] > 0)
  const lines = [line(0, '', headers)]
  for (const row of rows) {
    lines.push(`${line(row.depth * INDENT, row.label, row.cells)}  ${bar(row.days, maxDays)}`)
  }

  // Per-person day counts overlap, so a column of them adds up past its total.
  // Say so, rather than letting the numbers look like a broken sum.
  if (overlaps(stats.groups, stats.days)) {
    const total = stats.groups.reduce((sum, g) => sum + g.days, 0)
    const shared = 'a day two people both worked counts once'
    lines.push('')
    lines.push(
      dimensions[0] === 'author'
        ? `  ${total} days listed, ${stats.days} distinct — ${shared}.`
        : `  Per-person days overlap: ${shared} in the total.`
    )
  }
  return lines
}

function render(stats, meta, opts) {
  const lines = []
  if (stats.commits === 0) {
    lines.push(`No commits found on ${meta.ref}${meta.filter}.`)
    return lines.join('\n')
  }

  lines.push(
    `${stats.days} ${stats.days === 1 ? 'day' : 'days'} of work on ${meta.ref}${meta.filter}`
  )
  lines.push('')
  lines.push(`  commits         ${stats.commits}`)
  lines.push(`  first day       ${stats.first}`)
  lines.push(`  last day        ${stats.last}`)
  lines.push(`  calendar span   ${plural(stats.spanDays, 'day')}`)
  lines.push(`  longest streak  ${plural(stats.longestStreak, 'day')}`)
  lines.push(`  commits per day ${(stats.commits / stats.days).toFixed(1)} avg`)
  if (stats.authors > 1) lines.push(`  authors         ${stats.authors}`)

  if (opts.by.length) {
    lines.push('')
    lines.push(...renderGroups(stats))
  }

  if (opts.list) {
    const max = Math.max(...stats.breakdown.map((d) => d.commits))
    const width = String(max).length
    lines.push('')
    for (const day of stats.breakdown) {
      const count = String(day.commits).padStart(width)
      const who = stats.authors > 1 ? `  ${day.authors.join(', ')}` : ''
      lines.push(`  ${day.day}  ${count}  ${bar(day.commits, max)}${who}`)
    }
  }

  return lines.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  assertGitRepo(cwd)

  let author = opts.author
  if (opts.me) {
    const email = currentUserEmail(cwd)
    if (!email) fail('no git user.email configured, so --me has nobody to match')
    author = email
  }

  const commits = readCommits({ ...opts, cwd, author })
  const stats = summarize(commits, {
    tz: opts.tz,
    dayStart: opts.dayStart,
    use: opts.use,
    by: opts.by,
  })

  const filters = []
  if (author) filters.push(`by ${author}`)
  if (opts.base) filters.push(`not in ${opts.base}`)
  if (opts.since) filters.push(`since ${opts.since}`)
  if (opts.until) filters.push(`until ${opts.until}`)
  const meta = {
    ref: describeRef(opts.ref, cwd),
    filter: filters.length ? ` (${filters.join(', ')})` : '',
  }

  if (opts.json) {
    console.log(JSON.stringify({ ref: meta.ref, ...stats }, null, 2))
  } else {
    console.log(render(stats, meta, opts))
  }
}

try {
  main()
} catch (err) {
  fail(err.message)
}
