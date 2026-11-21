import { expect, test } from 'bun:test'
import { candidates, orphaned, split, type LsBox } from './boxes.ts'

const box = (boxId: string, roots: string[], more: Partial<LsBox> = {}): LsBox => ({
  boxId,
  service: 'web',
  size: 'standard',
  power: 'awake',
  waking: false,
  url: null,
  worktrees: roots.map((root) => ({ root, name: root.split('/').pop()! })),
  ...more,
})

test('a deleted workspace takes only the boxes no surviving worktree uses', () => {
  const boxes = [box('box_a', ['/w/gone']), box('box_b', ['/w/gone', '/w/kept']), box('box_c', ['/w/kept']), box('box_d', []), { ...box('box_e', []), worktrees: undefined }]
  expect(orphaned(boxes, '/w/gone', (root) => root === '/w/kept')).toEqual(['box_a'])
})

test('a workspace that is still on disk keeps its boxes', () => {
  expect(orphaned([box('box_a', ['/w/here'])], '/w/here', () => true)).toEqual([])
})

test('boxes sort into this workspace, other workspaces, and neither', () => {
  const boxes = [box('box_a', ['/w/here']), box('box_b', ['/w/there'], { service: null, power: 'asleep', waking: true }), box('box_c', [])]
  expect(split(boxes, '/w/here')).toEqual({
    here: [{ id: 'box_a', name: 'web', size: 'standard', power: 'awake', url: null }],
    elsewhere: [{ id: 'box_b', name: 'workbench', size: 'standard', power: 'waking', url: null, worktree: 'there' }],
  })
  expect(split(boxes, null).here).toEqual([])
})

test('workspaces that share a name and branch across repos all stay candidates, never the first', () => {
  const rows = ['tesser', 'docs', 'site'].map((repo) => ({ id: `wt-${repo}`, name: 'main', path: `/code/${repo}`, branch: 'refs/heads/main' }))
  const all = [...rows, { id: 'wt-fix', name: 'fix-login', path: '/code/fix', branch: 'fix-login' }]
  expect(candidates(all, { displayName: 'main', branch: 'main' }).map((row) => row.path)).toEqual(['/code/tesser', '/code/docs', '/code/site'])
  expect(candidates(all, { displayName: 'fix-login', branch: 'refs/heads/fix-login' }).map((row) => row.path)).toEqual(['/code/fix'])
  expect(candidates(all, { id: 'wt-docs', displayName: 'main', branch: 'main' }).map((row) => row.path)).toEqual(['/code/docs'])
  expect(candidates(all, { displayName: 'renamed in Orca', branch: 'fix-login' }).map((row) => row.path)).toEqual(['/code/fix'])
})
