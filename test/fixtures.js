/** A commit shaped the way readCommits hands them over. */
export const commit = (iso, name = 'Ada', email = `${name.toLowerCase()}@example.com`) => ({
  hash: iso,
  authorEpoch: Date.parse(iso),
  authorIso: iso,
  committerEpoch: Date.parse(iso),
  committerIso: iso,
  name,
  email,
  subject: 'work',
})

/** The same, tagged with the repo it came from, as readRepoCommits does. */
export const inRepo = (repo, iso, name) => ({ ...commit(iso, name), repo })
