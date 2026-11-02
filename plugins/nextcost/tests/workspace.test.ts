// The workspace's pure logic: git state from porcelain v2, and the folder path.

import { test, expect } from 'claude-code/testing'
import {
  gitSummary,
  homeRelative,
  parseGitState,
  printable,
  splitPath,
  type GitState,
} from '../hooks/workspace'

const OID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const MAIN_DIRS = '/r/p/.git\n/r/p/.git\n/r/p\n'
const LINKED_DIRS = '/r/p/.git/worktrees/admin-name\n/r/p/.git\n/r/wt/fix-ui\n'

const status = (...lines: string[]): string => lines.map((l) => `${l}\n`).join('')
const head = (name: string, oid = OID): string[] => [`# branch.oid ${oid}`, `# branch.head ${name}`]
const tracking = (ahead: number, behind: number): string[] => [
  '# branch.upstream origin/main',
  `# branch.ab +${ahead} -${behind}`,
]

const state = (over: Partial<GitState> = {}): GitState => ({
  branch: 'main',
  commit: 'a1b2c3d',
  worktree: undefined,
  changed: 0,
  ahead: undefined,
  behind: undefined,
  ...over,
})

test('a clean branch in sync with its upstream', () => {
  expect(parseGitState(status(...head('main'), ...tracking(0, 0)), MAIN_DIRS)).toStrictEqual(state({ ahead: 0, behind: 0 }))
})

test('every changed entry counts once: staged, unstaged, both, renamed, unmerged and untracked', () => {
  const s = status(
    ...head('main'),
    '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
    '1 .M N... 100644 100644 100644 aaa bbb unstaged.ts',
    '1 MM N... 100644 100644 100644 aaa bbb both.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
    '? untracked.ts',
  )
  expect(parseGitState(s, MAIN_DIRS)?.changed).toBe(6)
})

test('ignored entries are not changes', () => {
  expect(parseGitState(status(...head('main'), '! build/out.js', '? new.ts'), MAIN_DIRS)?.changed).toBe(1)
})

test('ahead only, behind only, and both', () => {
  expect(parseGitState(status(...head('main'), ...tracking(2, 0)), MAIN_DIRS)).toStrictEqual(state({ ahead: 2, behind: 0 }))
  expect(parseGitState(status(...head('main'), ...tracking(0, 3)), MAIN_DIRS)).toStrictEqual(state({ ahead: 0, behind: 3 }))
  expect(parseGitState(status(...head('main'), ...tracking(4, 5)), MAIN_DIRS)).toStrictEqual(state({ ahead: 4, behind: 5 }))
})

test('no upstream leaves ahead and behind unknown', () => {
  expect(parseGitState(status(...head('feature')), MAIN_DIRS)).toStrictEqual(state({ branch: 'feature' }))
})

test('an upstream that is gone, with no ab line, leaves them unknown too', () => {
  expect(parseGitState(status(...head('main'), '# branch.upstream origin/main'), MAIN_DIRS)).toStrictEqual(state())
})

test('a detached HEAD has no branch and keeps the short commit', () => {
  expect(parseGitState(status(...head('(detached)')), MAIN_DIRS)).toStrictEqual(state({ branch: undefined }))
})

test('a branch keeps the short commit too', () => {
  expect(parseGitState(status(...head('main')), MAIN_DIRS)?.commit).toBe('a1b2c3d')
})

test('a branch with no commits yet has no commit', () => {
  expect(parseGitState(status(...head('main', '(initial)'), '? a.ts'), MAIN_DIRS)).toStrictEqual(
    state({ commit: undefined, changed: 1 }),
  )
})

test('a linked worktree is named by its folder, not its admin dir', () => {
  expect(parseGitState(status(...head('fix')), LINKED_DIRS)?.worktree).toBe('fix-ui')
  expect(parseGitState(status(...head('fix')), '/r/p/.git/worktrees/x\n/r/p/.git\n/r/wt/fix-ui/\n')?.worktree).toBe('fix-ui')
})

test('the main working tree is no worktree', () => {
  expect(parseGitState(status(...head('main')), MAIN_DIRS)).toStrictEqual(state())
})

test('git older than 2.31 echoes --path-format back; its relative dirs are no worktree', () => {
  expect(parseGitState(status(...head('main')), '--path-format=absolute\n.git\n.git\n/r/p\n')).toStrictEqual(state())
  expect(parseGitState(status(...head('main')), '/r/p/sub/.git\n../.git\n/r/p\n')).toStrictEqual(state())
})

test('missing or short dirs output leaves the worktree unknown, the rest intact', () => {
  const s = status(...head('main'), '? a.ts')
  expect(parseGitState(s, '')).toStrictEqual(state({ changed: 1 }))
  expect(parseGitState(s, '/r/p/.git/worktrees/x\n/r/p/.git\n')).toStrictEqual(state({ changed: 1 }))
})

test('CRLF line endings read the same', () => {
  const s = [...head('main'), ...tracking(1, 2), '1 .M N... 100644 100644 100644 aaa bbb a.ts', '? b.ts', ''].join('\r\n')
  const dirs = '/r/p/.git/worktrees/x\r\n/r/p/.git\r\n/r/wt/fix-ui\r\n'
  expect(parseGitState(s, dirs)).toStrictEqual(state({ worktree: 'fix-ui', changed: 2, ahead: 1, behind: 2 }))
})

test('a branch name ending in a CR does not keep it', () => {
  expect(parseGitState('# branch.oid (initial)\r\n# branch.head main\r\n', '')?.branch).toBe('main')
})

test('not a repo, empty or garbage output is no state', () => {
  expect(parseGitState('', '')).toBeUndefined()
  expect(parseGitState('fatal: not a git repository (or any of the parent directories): .git\n', '')).toBeUndefined()
  expect(parseGitState('? a.ts\n1 .M N... 100644 100644 100644 aaa bbb b.ts\n', MAIN_DIRS)).toBeUndefined()
})

test('a path under home starts with ~', () => {
  expect(homeRelative('/Users/x/workspace/p', '/Users/x')).toBe('~/workspace/p')
  expect(homeRelative('/Users/x/workspace/p', '/Users/x/')).toBe('~/workspace/p')
})

test('home itself is ~', () => {
  expect(homeRelative('/Users/x', '/Users/x')).toBe('~')
  expect(homeRelative('/Users/x/', '/Users/x')).toBe('~')
  expect(homeRelative('/Users/x', '/Users/x/')).toBe('~')
})

test('a path outside home, or only sharing its prefix, is unchanged', () => {
  expect(homeRelative('/opt/p', '/Users/x')).toBe('/opt/p')
  expect(homeRelative('/Users/xy/p', '/Users/x')).toBe('/Users/xy/p')
  expect(homeRelative('/Users/xy', '/Users/x')).toBe('/Users/xy')
})

test('no home, an empty home or a root home changes nothing', () => {
  expect(homeRelative('/Users/x/p', undefined)).toBe('/Users/x/p')
  expect(homeRelative('/Users/x/p', '')).toBe('/Users/x/p')
  expect(homeRelative('/Users/x/p', '/')).toBe('/Users/x/p')
})

test('a path splits into its parent and its name', () => {
  expect(splitPath('~/workspace/nextcost')).toEqual({ parent: '~/workspace/', name: 'nextcost' })
  expect(splitPath('/Users')).toEqual({ parent: '/', name: 'Users' })
  expect(splitPath('~/p')).toEqual({ parent: '~/', name: 'p' })
  expect(splitPath('nextcost')).toEqual({ parent: '', name: 'nextcost' })
  expect(splitPath('~/workspace/nextcost/')).toEqual({ parent: '~/workspace/', name: 'nextcost' })
})

test('a root is all name', () => {
  expect(splitPath('~')).toEqual({ parent: '', name: '~' })
  expect(splitPath('/')).toEqual({ parent: '', name: '/' })
})

test('the summary reads the branch, changes and tracking', () => {
  expect(gitSummary(state({ changed: 3, ahead: 2, behind: 1 }))).toBe('branch main, 3 changed, 2 ahead, 1 behind')
})

test('the summary reads a detached worktree', () => {
  expect(gitSummary(state({ branch: undefined, worktree: 'fix-ui' }))).toBe('detached at a1b2c3d, worktree fix-ui, clean')
})

test('the summary says nothing of tracking that is even or absent', () => {
  expect(gitSummary(state({ ahead: 0, behind: 0 }))).toBe('branch main, clean')
  expect(gitSummary(state())).toBe('branch main, clean')
  expect(gitSummary(state({ changed: 1, ahead: 0, behind: 4 }))).toBe('branch main, 1 changed, 4 behind')
})

test('the summary reads a branch with no commits yet', () => {
  expect(gitSummary(state({ commit: undefined }))).toBe('branch main, no commits yet, clean')
})

test('the summary reads a detached HEAD without a commit', () => {
  expect(gitSummary(state({ branch: undefined, commit: undefined }))).toBe('detached, clean')
})


// ── what is drawn is printable ─────────────────────────────────────────

test('a control character, a line break and a bidi control are each one question mark', () => {
  expect(printable('a\nb\r\tc\u0000\u0007\u007F\u009B\u2028\u2029')).toBe('a?b??c??????')
  expect(printable('main\u202Eevil\u202D\u2066x\u2069\u061C\u200E\u200F')).toBe('main?evil??x????')
})

test('what prints stays as it is: Persian and Japanese names, a joiner, a space, emoji', () => {
  for (const name of ['پروژه‌ی من', 'my project', 'プロジェクト', 'a\u200Db', 'feat/🙂', 'ünï', '']) expect(printable(name)).toBe(name)
})

test('a branch with a bidi control or a worktree with a control character is printable in the state', () => {
  expect(parseGitState(status(...head('feat\u202Eevil')), MAIN_DIRS)?.branch).toBe('feat?evil')
  const linked = parseGitState(status(...head('main')), '/r/p/.git/worktrees/w\n/r/p/.git\n/r/wt/fix\u0007ui\n')
  expect(linked?.worktree).toBe('fix?ui')
})
