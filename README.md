# how-many-days

Counts the **distinct days of work** registered in a git branch — not commits, not
calendar span, but the number of separate days somebody actually committed something.

```
$ how-many-days
144 days of work on master

  commits         487
  first day       2017-05-30
  last day        2026-05-20
  calendar span   3278 days
  longest streak  8 days
  commits per day 3.4 avg
  authors         3
```

## Install

```sh
npm install -g .          # from a clone
npm install -g how-many-days
```

Installs three equivalent commands: `how-many-days`, `howManyDays`, and `hmd`.

Without installing:

```sh
npx how-many-days
```

## Usage

```
how-many-days [options] [-- <git log args>]

  -l, --list              show a per-day breakdown
  -j, --json              print machine-readable JSON
  -m, --me                only your own commits (git config user.email)
  -a, --author <pattern>  only commits matching an author pattern
  -s, --since <date>      only commits after a date ("2 weeks ago", 2026-01-01)
  -u, --until <date>      only commits before a date
  -b, --branch <ref>      branch or ref to inspect (default: HEAD)
      --base <ref>        count only commits not already in <ref>, e.g. main
      --tz author|local   bucket by the commit's own timezone or yours
      --day-start <h>     hour that starts a work day (default: 0)
      --committer         use committer dates instead of author dates
      --no-merges         ignore merge commits
  -h, --help              show this help
  -V, --version           show version
```

Anything after `--` goes straight to `git log`, so `how-many-days -- --first-parent`
or `-- -- src/` work as you'd expect.

### Examples

```sh
how-many-days --me --list              # my days, with a histogram
how-many-days --base main              # days spent on this branch alone
how-many-days --since "3 months ago"   # a recent slice
how-many-days --day-start 5 --tz local # 2am commits count as the day before
how-many-days --json | jq .days        # one number, for scripts
```

## How days are counted

- **Author date, not committer date.** Rebases and cherry-picks rewrite committer
  dates; author dates keep the day the work was written. Use `--committer` to flip.
- **The author's own timezone.** A commit stamped `23:30 +02:00` counts as that
  day, even though it is the previous day in UTC. `--tz local` re-projects
  everything into your timezone instead.
- **`--day-start`** moves the midnight boundary, so late-night sessions land on the
  day they started rather than splitting in two.

## Development

```sh
npm test
```
