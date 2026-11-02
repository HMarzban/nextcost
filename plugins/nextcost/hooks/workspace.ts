// The workspace: git state from porcelain v2, and the folder path, as the band words them.

export type GitState = Readonly<{
  /** The branch, or undefined when HEAD is detached. */
  branch: string | undefined
  /** The short commit (7 chars), for a detached HEAD or a branch with no commits yet (undefined then). */
  commit: string | undefined
  /** The linked worktree's folder name; undefined in the main working tree. */
  worktree: string | undefined
  /** Files with uncommitted changes, staged, unstaged or untracked, each counted once. */
  changed: number
  /** Commits ahead of / behind the upstream; undefined when there is no upstream. */
  ahead: number | undefined
  behind: number | undefined
}>

/** Where the session is: its project, home-relative, git there, and, for a
 *  linked worktree, its main repository's folder name. */
export type Workspace = Readonly<{ path: string; git: GitState | undefined; repoName: string | undefined }>

const lines = (text: string): string[] => text.split(/\r?\n/).map(line => line.replace(/\r$/, ''))

/** A path without its trailing slashes. */
export const stripTrailingSlashes = (p: string): string => p.replace(/\/+$/, '')

/** The same, keeping a lone `/`, which is a root, not a slash. */
const trimSlash = (p: string): string => (p.length > 1 ? stripTrailingSlashes(p) : p)

const basename = (p: string): string => trimSlash(p).split('/').pop() ?? ''

/** Porcelain v2 entries that are changes: ordinary, renamed, unmerged, untracked. */
const CHANGED = /^[12u?] /

const isAbsolute = (p: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(p)

/** The worktree's folder name when git-dir and common-dir differ; else
 *  undefined. Git before 2.31 echoes the unknown `--path-format` back and
 *  answers relative paths, which can differ in the main tree, so only three
 *  absolute lines count. */
const worktreeName = (dirs: string): string | undefined => {
  const found = lines(dirs).filter(line => line !== '')
  if (found.length !== 3 || !found.every(isAbsolute)) return undefined
  const [gitDir, commonDir, top] = found
  if (!gitDir || !commonDir || !top) return undefined
  return trimSlash(gitDir) === trimSlash(commonDir) ? undefined : basename(top) || undefined
}

/** Control characters, line and paragraph separators and the bidi controls
 *  (embeddings, overrides, isolates and marks): one of them in a name breaks
 *  a one-row strip, or draws the text after it reversed. */
const UNPRINTABLE = /[\p{Cc}\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu

/** A name from the file system or git as the band may draw it: each of
 *  those characters a `?`, one column wide. Joiners and every script's
 *  letters stay. */
export const printable = (name: string): string => name.replace(UNPRINTABLE, '?')

/** The git state in `status`, porcelain v2 with its branch headers, and
 *  `dirs`, rev-parse's three paths. Undefined without a `# branch.head`
 *  line: not a repo, or not porcelain v2. */
export const parseGitState = (status: string, dirs: string): GitState | undefined => {
  let head: string | undefined
  let oid: string | undefined
  let ahead: number | undefined
  let behind: number | undefined
  let changed = 0
  for (const line of lines(status)) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length)
    else if (line.startsWith('# branch.ab ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (CHANGED.test(line)) changed++
  }
  if (head === undefined) return undefined
  const worktree = worktreeName(dirs)
  return {
    branch: head === '(detached)' ? undefined : printable(head),
    commit: oid && oid !== '(initial)' ? oid.slice(0, 7) : undefined,
    worktree: worktree === undefined ? undefined : printable(worktree),
    changed,
    ahead,
    behind,
  }
}

/** `~` for home and `~/…` under it; anything else unchanged. */
export const homeRelative = (path: string, home: string | undefined): string => {
  const homeDir = home === undefined ? '' : stripTrailingSlashes(home)
  if (!homeDir) return path
  if (path === homeDir || path === `${homeDir}/`) return '~'
  return path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path
}

/** The parent keeps its trailing slash; a root is all name. */
export const splitPath = (path: string): Readonly<{ parent: string; name: string }> => {
  const p = trimSlash(path)
  const cut = p.lastIndexOf('/')
  if (p === '/' || cut < 0) return { parent: '', name: p }
  return { parent: p.slice(0, cut + 1), name: p.slice(cut + 1) }
}

/** One plain line for a screen reader or a hover. */
export const gitSummary = (g: GitState): string => {
  const parts = [
    g.branch !== undefined ? `branch ${g.branch}` : g.commit ? `detached at ${g.commit}` : 'detached',
  ]
  if (g.branch !== undefined && !g.commit) parts.push('no commits yet')
  if (g.worktree) parts.push(`worktree ${g.worktree}`)
  parts.push(g.changed ? `${g.changed} changed` : 'clean')
  if (g.ahead) parts.push(`${g.ahead} ahead`)
  if (g.behind) parts.push(`${g.behind} behind`)
  return parts.join(', ')
}
