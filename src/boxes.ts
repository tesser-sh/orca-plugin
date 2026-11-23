export interface LsBox {
  boxId: string
  service: string | null
  size: string
  power: string
  waking: boolean
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

export interface Workspace {
  id: string
  name: string
  path: string
  branch: string | null
}

const short = (ref: string | null): string => (ref ?? '').replace(/^refs\/heads\//, '')

export function candidates<Row extends Workspace>(rows: readonly Row[], focused: { id?: string; displayName: string; branch: string }): Row[] {
  const exact = rows.filter((row) => row.id === focused.id)
  if (exact.length > 0) return exact
  const onBranch = rows.filter((row) => short(row.branch) === short(focused.branch))
  const named = onBranch.filter((row) => row.name === focused.displayName)
  return named.length > 0 ? named : onBranch
}

export const BOX_ID = /^box_[0-9a-f]+$/

export function primaryPorts(stdout: string): Map<string, number> {
  const ports = new Map<string, number>()
  let rows: unknown
  try {
    rows = JSON.parse(stdout)
  } catch {
    return ports
  }
  if (!Array.isArray(rows)) return ports
  for (const row of rows as { service?: unknown; ports?: unknown }[]) {
    const port: unknown = Array.isArray(row.ports) ? row.ports[0] : undefined
    if (typeof row.service === 'string' && typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) ports.set(row.service, port)
  }
  return ports
}

export function link(box: Pick<LsBox, 'boxId' | 'service'>, ports: ReadonlyMap<string, number>): string | null {
  const port = box.service === null ? undefined : ports.get(box.service)
  return port === undefined || !BOX_ID.test(box.boxId) ? null : `http://box-${box.boxId.slice(4)}.localhost:${port}`
}

export function parseBoxes(stdout: string): LsBox[] {
  const rows: unknown = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('`tesser ls --json` did not print a list')
  return rows as LsBox[]
}

function row(box: LsBox, ports: ReadonlyMap<string, number>): Box {
  return { id: box.boxId, name: box.service ?? 'workbench', size: box.size, power: box.waking ? 'waking' : box.power, url: link(box, ports) }
}

export function orphaned(boxes: readonly LsBox[], root: string, exists: (root: string) => boolean): string[] {
  return boxes
    .filter((box) => {
      const trees = box.worktrees ?? []
      return trees.some((tree) => tree.root === root) && trees.every((tree) => !exists(tree.root))
    })
    .map((box) => box.boxId)
}

export function split(boxes: readonly LsBox[], root: string | null, ports: ReadonlyMap<string, number>): { here: Box[]; elsewhere: Elsewhere[] } {
  const here: Box[] = []
  const elsewhere: Elsewhere[] = []
  for (const box of boxes) {
    const trees = box.worktrees ?? []
    if (root !== null && trees.some((tree) => tree.root === root)) here.push(row(box, ports))
    else if (trees[0] !== undefined) elsewhere.push({ ...row(box, ports), worktree: trees[0].name })
  }
  return { here, elsewhere }
}
