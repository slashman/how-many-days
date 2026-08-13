# how-many-days

Counts the **distinct days of work** registered in a git branch — not commits, not
calendar span, but the number of separate days somebody actually committed something.
Across one repository or several at once.

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

  -r, --repo <path>       add a repository to the calculation; repeat for as
                          many as you like and their histories merge
  -l, --list              show a per-day breakdown
      --by <dimension>    break the days down by year, month, week, author or
                          repo; repeat to nest, outermost first
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
how-many-days --by year                # how many days of work each year
how-many-days --by week --me           # my pace, week by week
how-many-days --by author              # who put in how many days
how-many-days --by year --by author    # each year, broken down by person
how-many-days --base main              # days spent on this branch alone
how-many-days --since "3 months ago"   # a recent slice
how-many-days --day-start 5 --tz local # 2am commits count as the day before
how-many-days --json | jq .days        # one number, for scripts
how-many-days -r ../mobile -r ../api   # both repos, as one body of work
```

## Several repos at once

Work rarely lives in one repository. `--repo` adds another one to the same
calculation, as many times as you like:

```
$ how-many-days --repo product-mobile --repo product-backend
5 days of work on product-mobile, product-backend

  commits         7
  first day       2026-03-04
  last day        2026-03-08
  calendar span   5 days
  longest streak  5 days
  commits per day 1.4 avg
  authors         2
  repos           2
```

The histories **merge by day**, which is the whole point: a day you touched both
the app and the backend is one day of work, not two. Streaks close over the seam
as well, so committing to the mobile app on Monday and the backend on Tuesday is
a two-day streak.

Paths are relative to where you run the command, so you normally run it from the
directory holding your checkouts — which doesn't have to be a repository itself.
Repos are named after their directory, unless two of them share a name, in which
case both are labelled with the path you typed. Naming the same repo twice counts
it once. `--branch`, `--since`, `--base` and the rest apply to every repo, and if
one of them can't answer — no such branch, say — the error names the repo.

`--by repo` shows what each one contributed, and nests with the other dimensions
like anything else:

```
$ how-many-days -r product-mobile -r product-backend --by repo --by author

                   days  commits  authors
  product-backend     3        4        2  ########################
    Ada               2        2  ################
    Grace             2        2  ################
  product-mobile      3        3        1  ########################
    Ada               3        3  ########################

  6 days listed, 5 distinct — a day worked in two repos counts once, and a day two people both worked counts once.
```

With `--list`, each day names the repos it was worked in; with `--json`, every
day carries a `repos` array and the top level lists each repo with the ref that
was counted.

## Breakdowns

`--by year|month|week|author|repo` breaks the days down along a dimension. Every
column counts days of work, so a year that saw two commits reports 1 day, not
365 — and buckets with no work at all are left out rather than printed as zeroes.

```
$ how-many-days --by year
584 days of work on master

  commits         3180
  first day       2014-03-10
  last day        2026-06-15
  calendar span   4481 days
  longest streak  13 days
  commits per day 5.4 avg
  authors         5

        days  commits  authors
  2014   166     1017        3  #######################
  2015   175     1077        1  ########################
  2016   139      619        3  ###################
  2017    76      335        1  ##########
  2018     2       10        1  #
```

The bar tracks days rather than commits — one frantic afternoon shouldn't
out-draw a steady fortnight. Weeks are ISO weeks, labelled `2026-W32`, so a week
straddling New Year belongs to the year holding its Thursday (which is why
`2025-12-29` reports as `2026-W01`).

### Nesting dimensions

Repeat `--by` to break one dimension down by another, outermost first. The order
is the view: `--by year --by author` is a row per year with its people
underneath, and `--by author --by year` inverts it. `--by year,author` is
shorthand for the same thing. One period at a time, so `--by year --by month` is
an error rather than a guess; periods, people and repos combine freely otherwise,
as in `--by year --by repo --by author`.

```
$ how-many-days --by year --by author --since 2016-11-01 --until 2017-01-01
42 days of work on master (since 2016-11-01, until 2017-01-01)

  ...

                     days  commits  authors
  2016                 42      156        2  ########################
    slash              37      131  #####################
    Santiago Zapata     6       25  ###

  These days overlap: a day two people both worked counts once.
```

Per-person and per-repo day counts overlap, which is why they add up to more than
the total above them: a day two people both worked is one day of work, and it
belongs to both of them, exactly as a day spent in two repos belongs to both. The
tool says so rather than leaving the sum looking broken.

People are identified by **email**, not by name, so one contributor who has
spelled `user.name` three different ways over the years stays one row — labelled
with whichever spelling they used most. Two different people who genuinely share
a name get their email appended, and only then, so the common case stays clean.

Combine with `--list` for the per-day histogram underneath, and with `--json` for
a `groups` array — nested identically, and carrying each bucket's `first` and
`last` day, which the table leaves out to save width.

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
