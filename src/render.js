import { OVERLAPPING_UNITS } from './index.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const BAR_WIDTH = 24
const bar = (value, max) => '#'.repeat(Math.max(1, Math.round((value / max) * BAR_WIDTH)))

const HEADERS = ['days', 'commits', 'authors']
const INDENT = 2

/** Why an overlapping dimension's day counts sum past the total above them. */
const SHARED_DAY = {
  author: 'a day two people both worked counts once',
  repo: 'a day worked in two repos counts once',
}

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
export function renderGroups(stats, bars = true) {
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
  // Every column keeps its slot even on the rows that have nothing to put in it,
  // so that the bars which follow all start in the same place. Rows deep enough
  // to have dropped the authors count would otherwise pull their bar left by the
  // width of that column, and the table would read as broken.
  const line = (indent, label, cells) => {
    const padded = widths.flatMap((width, i) =>
      width > 0 ? [`  ${String(cells[i] ?? '').padStart(width)}`] : []
    )
    return `  ${' '.repeat(indent)}${label.padEnd(labelField - indent)}${padded.join('')}`
  }

  const headers = HEADERS.filter((_, i) => widths[i] > 0)
  const lines = [line(0, '', headers)]
  for (const row of rows) {
    const chart = bars ? `  ${bar(row.days, maxDays)}` : ''
    // Reserved-but-empty columns leave trailing blanks when no bar follows them.
    lines.push(`${line(row.depth * INDENT, row.label, row.cells)}${chart}`.trimEnd())
  }

  // Per-person and per-repo day counts overlap, so a column of them adds up past
  // its total. Say so, rather than letting the numbers look like a broken sum.
  if (overlaps(stats.groups, stats.days)) {
    const total = stats.groups.reduce((sum, g) => sum + g.days, 0)
    const shared = dimensions
      .filter((d) => OVERLAPPING_UNITS.includes(d))
      .map((d) => SHARED_DAY[d])
      .join(', and ')
    lines.push('')
    lines.push(
      OVERLAPPING_UNITS.includes(dimensions[0])
        ? `  ${total} days listed, ${stats.days} distinct — ${shared}.`
        : `  These days overlap: ${shared}.`
    )
  }
  return lines
}

export function render(stats, meta, opts) {
  const lines = []
  const multiRepo = meta.repos.length > 1
  // Bars unless --no-bars said otherwise, in the table and the breakdown alike.
  const bars = opts.bars ?? true
  if (stats.commits === 0) {
    lines.push(`No commits found on ${meta.target}${meta.filter}.`)
    return lines.join('\n')
  }

  lines.push(
    `${stats.days} ${stats.days === 1 ? 'day' : 'days'} of work on ${meta.target}${meta.filter}`
  )
  lines.push('')
  lines.push(`  commits         ${stats.commits}`)
  lines.push(`  first day       ${stats.first}`)
  lines.push(`  last day        ${stats.last}`)
  lines.push(`  calendar span   ${plural(stats.spanDays, 'day')}`)
  lines.push(`  longest streak  ${plural(stats.longestStreak, 'day')}`)
  lines.push(`  commits per day ${(stats.commits / stats.days).toFixed(1)} avg`)
  if (stats.authors > 1) lines.push(`  authors         ${stats.authors}`)
  if (multiRepo) lines.push(`  repos           ${meta.repos.length}`)

  if (opts.by.length) {
    lines.push('')
    lines.push(...renderGroups(stats, bars))
  }

  if (opts.list) {
    const max = Math.max(...stats.breakdown.map((d) => d.commits))
    const width = String(max).length
    // Names are a list of their own, so the repos after them have to clear the
    // longest of them — otherwise a two-author day shunts its repos out of line.
    const names = stats.authors > 1 ? stats.breakdown.map((d) => d.authors.join(', ')) : []
    const nameField = Math.max(0, ...names.map((n) => n.length))
    lines.push('')
    for (const [i, day] of stats.breakdown.entries()) {
      const count = String(day.commits).padStart(width)
      // "in" rather than a bare list, so repo names can't be read as more names.
      const where = multiRepo ? `  in ${day.repos.join(', ')}` : ''
      const who = names.length ? `  ${where ? names[i].padEnd(nameField) : names[i]}` : ''
      const trail = `${who}${where}`
      // Bars vary in length, so anything following one has to clear the full
      // width of the chart to land in a column of its own. Nothing following
      // means nothing to line up, and no trailing blanks either.
      const graph = bar(day.commits, max)
      const chart = bars ? `  ${trail ? graph.padEnd(BAR_WIDTH) : graph}` : ''
      lines.push(`  ${day.day}  ${count}${chart}${trail}`)
    }
  }

  return lines.join('\n')
}
