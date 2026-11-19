export interface LsBox {
  boxId: string
  service: string | null
  size: string
  power: string
  waking: boolean
  url?: string | null
  worktrees?: { root: string; name: string }[]
}

export interface Box {
  id: string
  name: string
  size: string
  power: string
  url: string | null
}

export interface Elsewhere extends Box {
  worktree: string
}

export function parseBoxes(stdout: string): LsBox[] {
  const rows: unknown = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('`tesser ls --json` did not print a list')
  return rows as LsBox[]
}

function row(box: LsBox): Box {
  return { id: box.boxId, name: box.service ?? 'workbench', size: box.size, power: box.waking ? 'waking' : box.power, url: box.url ?? null }
}

export function orphaned(boxes: readonly LsBox[], root: string, exists: (root: string) => boolean): string[] {
  return boxes
    .filter((box) => {
      const trees = box.worktrees ?? []
      return trees.some((tree) => tree.root === root) && trees.every((tree) => !exists(tree.root))
    })
    .map((box) => box.boxId)
}

export function split(boxes: readonly LsBox[], root: string | null): { here: Box[]; elsewhere: Elsewhere[] } {
  const here: Box[] = []
  const elsewhere: Elsewhere[] = []
  for (const box of boxes) {
    const trees = box.worktrees ?? []
    if (root !== null && trees.some((tree) => tree.root === root)) here.push(row(box))
    else if (trees[0] !== undefined) elsewhere.push({ ...row(box), worktree: trees[0].name })
  }
  return { here, elsewhere }
}
