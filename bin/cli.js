#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
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
  how-many-days --base main              days spent on this branch alone
  how-many-days --day-start 5 --tz local nights count toward the day before
  how-many-days -- --first-parent        forward extra flags to git log
`.trim()

function parseArgs(argv) {
  const opts = {
    list: false,
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

  if (opts.list) {
    const max = Math.max(...stats.breakdown.map((d) => d.commits))
    const width = String(max).length
    lines.push('')
    for (const day of stats.breakdown) {
      const bar = '#'.repeat(Math.max(1, Math.round((day.commits / max) * 24)))
      const count = String(day.commits).padStart(width)
      const who = stats.authors > 1 ? `  ${day.authors.join(', ')}` : ''
      lines.push(`  ${day.day}  ${count}  ${bar}${who}`)
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
  const stats = summarize(commits, { tz: opts.tz, dayStart: opts.dayStart, use: opts.use })

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
