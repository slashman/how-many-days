# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-13

### Added

- `--repo <path>` (`-r`), repeatable, to add repositories to one calculation.
  Their histories merge by day, so a day spent in the mobile app and the backend
  is one day of work rather than two, and streaks close over the seam. Named
  repos stand in for the working directory entirely, which therefore no longer
  has to be a repository itself.
- `--by repo`, composing with the existing dimensions like any other, so
  `--by year --by repo --by author` nests three deep.
- `--no-bars`, to print the counts without the histogram.
- `--json` now carries a `repos` array listing each repository and the ref
  counted in it, and each `breakdown` day names the repos it was worked in.
  `ref` is still emitted when there is a single history to name.

### Fixed

- Histogram bars no longer shift left on rows that omit the authors count, which
  made every `--by … --by author` table read as broken — worse the deeper it
  nested. All columns now hold their position whether or not a row fills them.
- `--list` annotations line up in a column, instead of being pushed around by the
  length of the bar and of the author list before them.

### Changed

- `--me` resolves `user.email` per repository, since a repo-local setting shadows
  the global one and one identity need not cover every checkout.

## [1.1.0] - 2026-08-10

### Added

- `--by year|month|week` to roll days up into periods, with ISO week labels.
- `--by author`, as a dimension that composes with the periods: repeat `--by` to
  nest, outermost first, so `--by year --by author` and `--by author --by year`
  are two views of the same data.
- Per-person day counts are reported as overlapping rather than left looking like
  a broken sum, since a day two people both worked is one day of work.

## [1.0.0] - 2026-08-09

### Added

- Initial release. Counts the distinct days of work in a git branch, with
  `--list`, `--json`, `--me`, `--author`, `--since`, `--until`, `--branch`,
  `--base`, `--tz`, `--day-start`, `--committer` and `--no-merges`, plus
  passthrough of anything after `--` to `git log`.

[1.2.0]: https://github.com/slashman/how-many-days/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/slashman/how-many-days/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/slashman/how-many-days/releases/tag/v1.0.0
