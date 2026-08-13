#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GROUP_UNITS,
  PERIOD_UNITS,
  assertGitRepo,
  currentUserEmail,
  describeRef,
  readRepoCommits,
  resolveRepos,
  summarize,
} from '../src/index.js'
import { render } from '../src/render.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
)

const HELP = `
how-many-days — count the distinct days of work registered in a git branch

Usage
  how-many-days [options] [-- <git log args>]

Options
  -r, --repo <path>       add a repository to the calculation. Repeat it for as
                          many as you like and their histories merge, so a day
                          worked in two repos still counts as one day
  -l, --list              show a per-day breakdown
      --by <dimension>    break the days down by year, month, week (ISO weeks),
                          author or repo. Repeat it to nest one dimension inside
                          another, outermost first: --by year --by author is a
                          row per year with its people underneath, and
                          --by author --by year inverts that
      --no-bars           leave the histogram out, printing the counts alone
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
  how-many-days -r ../mobile -r ../api   days across two repos, merged
  how-many-days -r ../mobile -r ../api --by repo
                                         …and how many each of them saw
`.trim()

function parseArgs(argv) {
  const opts = {
    repos: [],
    list: false,
    by: [],
    bars: true,
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
      case '--no-bars':
        opts.bars = false
        break
      case '-r':
      case '--repo':
        opts.repos.push(need(i, arg))
        i++
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

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  // Named repos stand in for the working directory entirely: you run this from
  // wherever your checkouts happen to live, which needn't be a repo itself.
  const named = opts.repos.length > 0
  const repos = named
    ? resolveRepos(opts.repos, cwd)
    : [{ spec: '.', path: cwd, label: basename(cwd) }]
  if (named) {
    for (const repo of repos) {
      if (!existsSync(repo.path)) fail(`${repo.spec}: no such directory`)
    }
  } else {
    assertGitRepo(cwd)
  }

  // One author pattern for every repo, unless --me gives each its own.
  let author = opts.author
  let who = author
  if (opts.me) {
    // Each repo knows who I am in it: a repo-local user.email shadows the global
    // one, so ask inside each rather than assuming one identity covers them all.
    // Any repo that answers nothing borrows the first identity we did find.
    for (const repo of repos) repo.author = currentUserEmail(repo.path)
    const emails = [...new Set(repos.map((repo) => repo.author).filter(Boolean))]
    if (!emails.length) fail('no git user.email configured, so --me has nobody to match')
    for (const repo of repos) repo.author ||= emails[0]
    author = null
    who = emails.join(', ')
  }

  const commits = readRepoCommits(repos, { ...opts, author })
  const stats = summarize(commits, {
    tz: opts.tz,
    dayStart: opts.dayStart,
    use: opts.use,
    by: opts.by,
  })

  const described = repos.map((repo) => ({
    repo: repo.label,
    ref: describeRef(opts.ref, repo.path),
  }))
  const filters = []
  // With several repos the header names them instead of a branch, so an explicit
  // ref has nowhere else to go.
  if (named && opts.ref !== 'HEAD') filters.push(`on ${opts.ref}`)
  if (who) filters.push(`by ${who}`)
  if (opts.base) filters.push(`not in ${opts.base}`)
  if (opts.since) filters.push(`since ${opts.since}`)
  if (opts.until) filters.push(`until ${opts.until}`)
  const meta = {
    repos: described,
    target: named ? described.map((r) => r.repo).join(', ') : described[0].ref,
    filter: filters.length ? ` (${filters.join(', ')})` : '',
  }

  if (opts.json) {
    // `ref` only when there is one history to name; `repos` always, so a script
    // has one shape to read whether or not --repo was used.
    const ref = repos.length === 1 ? { ref: described[0].ref } : {}
    console.log(JSON.stringify({ ...ref, repos: described, ...stats }, null, 2))
  } else {
    console.log(render(stats, meta, opts))
  }
}

try {
  main()
} catch (err) {
  fail(err.message)
}
