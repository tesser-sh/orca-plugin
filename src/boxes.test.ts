import { expect, test } from 'bun:test'
import { orphaned, split, type LsBox } from './boxes.ts'

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
