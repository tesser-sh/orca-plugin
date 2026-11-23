import { expect, test } from 'bun:test'
import { candidates, link, orphaned, primaryPorts, split, type LsBox } from './boxes.ts'

const box = (boxId: string, roots: string[], more: Partial<LsBox> = {}): LsBox => ({
  boxId,
  service: 'web',
  size: 'standard',
  power: 'awake',
  waking: false,
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
  expect(split(boxes, '/w/here', new Map())).toEqual({
    here: [{ id: 'box_a', name: 'web', size: 'standard', power: 'awake', url: null }],
    elsewhere: [{ id: 'box_b', name: 'workbench', size: 'standard', power: 'waking', url: null, worktree: 'there' }],
  })
  expect(split(boxes, null, new Map()).here).toEqual([])
})

test('workspaces that share a name and branch across repos all stay candidates, never the first', () => {
  const rows = ['tesser', 'docs', 'site'].map((repo) => ({ id: `wt-${repo}`, name: 'main', path: `/code/${repo}`, branch: 'refs/heads/main' }))
  const all = [...rows, { id: 'wt-fix', name: 'fix-login', path: '/code/fix', branch: 'fix-login' }]
  expect(candidates(all, { displayName: 'main', branch: 'main' }).map((row) => row.path)).toEqual(['/code/tesser', '/code/docs', '/code/site'])
  expect(candidates(all, { displayName: 'fix-login', branch: 'refs/heads/fix-login' }).map((row) => row.path)).toEqual(['/code/fix'])
  expect(candidates(all, { id: 'wt-docs', displayName: 'main', branch: 'main' }).map((row) => row.path)).toEqual(['/code/docs'])
  expect(candidates(all, { displayName: 'renamed in Orca', branch: 'fix-login' }).map((row) => row.path)).toEqual(['/code/fix'])
})

test('a box opens on the first port of its service, and nothing else gets a link', () => {
  const ports = primaryPorts(JSON.stringify([{ service: 'web', ports: [8080, 3000] }, { service: 'worker', ports: [] }, { service: 'bad', ports: ['22; rm'] }]))
  const box = 'box_3f9a1c07d2e84b65'
  expect(link({ boxId: box, service: 'web' }, ports)).toBe('http://box-3f9a1c07d2e84b65.localhost:8080')
  expect(link({ boxId: box, service: null }, ports)).toBeNull()
  expect(link({ boxId: box, service: 'worker' }, ports)).toBeNull()
  expect(link({ boxId: box, service: 'bad' }, ports)).toBeNull()
  expect(link({ boxId: box, service: 'never registered' }, ports)).toBeNull()
  expect(link({ boxId: 'box_x.example.com', service: 'web' }, ports)).toBeNull()
  expect(primaryPorts('tesser: not signed in').size).toBe(0)
})
