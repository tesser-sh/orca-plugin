import { execFile, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { BOX_ID, candidates, link, orphaned, parseBoxes, primaryPorts, split, type LsBox } from './boxes.ts'
import type { State } from './protocol.ts'

const FRESH_MS = 15_000
const POLL_MS = 60_000
const PORTS_MS = 5 * 60_000
const NO_TELEMETRY = { ...process.env, TESSER_TELEMETRY: '0' }

interface Ran {
  ok: boolean
  missing: boolean
  stdout: string
  said: string
}

function run(cli: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(cli, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const code = error === null ? 0 : (error as NodeJS.ErrnoException).code
      resolve({ ok: error === null, missing: code === 'ENOENT', stdout, said: stderr.trim() || `${basename(cli)} ${args[0]} failed${typeof code === 'number' ? ` (exit ${code})` : ''}` })
    })
  })
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(canonical(parent), basename(path))
  }
}

async function deleted(path: string): Promise<boolean> {
  for (let tries = 0; tries < 20; tries++) {
    if (!existsSync(path)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function list(stdout: string): LsBox[] {
  return parseBoxes(stdout).map((box) => ({ ...box, worktrees: (box.worktrees ?? []).map((tree) => ({ ...tree, root: canonical(tree.root) })) }))
}

function tabOn(stdout: string, url: string): string | undefined {
  try {
    const tabs: { browserPageId: string; url: string }[] = JSON.parse(stdout).result?.tabs ?? []
    return tabs.find((tab) => tab.url.startsWith(url))?.browserPageId
  } catch {
    return undefined
  }
}

function terminalRoot(stdout: string, ids: readonly string[]): string | null {
  try {
    const terminals: { handle: string; worktreePath?: string }[] = JSON.parse(stdout).result?.terminals ?? []
    const path = terminals.find((terminal) => ids.includes(terminal.handle))?.worktreePath
    return path === undefined ? null : canonical(path)
  } catch {
    return null
  }
}

function orcaCli(): string {
  const entry = process.argv[1] ?? ''
  const cut = entry.indexOf('app.asar')
  const bundled = cut < 0 ? '' : join(entry.slice(0, cut), 'bin', 'orca')
  return existsSync(bundled) ? bundled : 'orca'
}

function openInBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

let poll: ReturnType<typeof setInterval> | undefined

export function deactivate(): void {
  clearInterval(poll)
}

export default function activate(orca: OrcaWorkerApi): void {
  let cached: { at: number; boxes: LsBox[] } | null = null
  let located: { key: string; path: string | null } | null = null
  let ports: { at: number; byService: Map<string, number>; unknown: Set<string> } = { at: 0, byService: new Map(), unknown: new Set() }
  let generation = 0

  const cli = async (): Promise<string> => {
    const set = await orca.settings.get('cli')
    if (typeof set === 'string' && set.trim() !== '') return set.trim()
    const installed = join(homedir(), '.tesser', 'bin', 'tesser')
    return existsSync(installed) ? installed : 'tesser'
  }

  const focused = async (): Promise<{ name: string; path: string | null; root: string | null } | null> => {
    const context = await orca.host.call('workspace.readContext', {})
    if (context === null) return null
    const { workspaces } = await orca.host.call('workspace.list', {})
    const hits = candidates(workspaces.filter((row) => row.kind === 'worktree' && (row.hostId === null || row.hostId === 'local')), context)
    let path = hits.length === 1 ? (hits[0]?.path ?? null) : null
    if (hits.length > 1) {
      const ids = context.terminals.map((terminal) => terminal.id)
      const key = JSON.stringify([context.displayName, context.branch, ids])
      if (located?.key !== key) {
        const listed = await run(orcaCli(), ['terminal', 'list', '--limit', '1000', '--json'], 15_000)
        if (!listed.ok) return { name: context.displayName, path: null, root: null }
        const root = terminalRoot(listed.stdout, ids)
        located = { key, path: hits.find((row) => canonical(row.path) === root)?.path ?? null }
      }
      path = located.path
    }
    return { name: context.displayName, path, root: path === null ? null : canonical(path) }
  }

  const state = async (fresh: boolean, failed: string | null = null): Promise<State> => {
    if (fresh || cached === null || Date.now() - cached.at > FRESH_MS) {
      const bin = await cli()
      const ran = await run(bin, ['ls', '--json'], 30_000, NO_TELEMETRY)
      if (ran.missing) return { status: 'no-cli' }
      if (!ran.ok) return { status: 'failed', message: ran.said }
      const boxes = list(ran.stdout)
      cached = { at: Date.now(), boxes }
      const unknown = (known: ReadonlyMap<string, number>): string[] => boxes.flatMap((box) => (box.service === null || known.has(box.service) ? [] : [box.service]))
      if (Date.now() - ports.at > PORTS_MS || unknown(ports.byService).some((service) => !ports.unknown.has(service))) {
        const services = await run(bin, ['service', 'ls', '--all', '--json'], 30_000, NO_TELEMETRY)
        if (services.ok) {
          const byService = primaryPorts(services.stdout)
          ports = { at: Date.now(), byService, unknown: new Set(unknown(byService)) }
        }
      }
    }
    const workspace = await focused()
    return { status: 'ok', workspace: workspace?.name ?? null, ...split(cached.boxes, workspace?.root ?? null, ports.byService), failed }
  }

  const publish = async (next: State): Promise<State> => {
    const here = next.status === 'ok' ? next.here : []
    const first = here[0]
    await orca.host
      .call(
        'statusBar.update',
        first === undefined
          ? { id: 'box', visible: false }
          : {
              id: 'box',
              visible: true,
              text: here.length === 1 ? `tesser ${first.power}` : `tesser ${here.filter((box) => box.power === 'awake').length}/${here.length} awake`,
              tone: here.some((box) => box.power === 'awake') ? 'success' : 'neutral',
              tooltip: first.url ?? first.id,
            },
      )
      .catch(() => {})
    orca.panels.post('tesser.changed', next)
    return next
  }

  const refresh = async (fresh: boolean): Promise<void> => {
    const mine = ++generation
    const next = await state(fresh).catch((error: unknown): State => ({ status: 'failed', message: error instanceof Error ? error.message : String(error) }))
    if (mine === generation) await publish(next)
  }

  const tesser = async (args: string[]): Promise<string | null> => {
    const ran = await run(await cli(), args, 110_000)
    return ran.ok ? null : ran.said
  }

  const show = async (url: string): Promise<void> => {
    const workspace = await focused()
    if (workspace === null || workspace.path === null) return openInBrowser(url)
    const at = ['--worktree', `path:${workspace.path}`]
    const listed = await run(orcaCli(), ['tab', 'list', ...at, '--json'], 10_000)
    const tab = listed.ok ? tabOn(listed.stdout, url) : undefined
    execFile(orcaCli(), tab === undefined ? ['tab', 'create', '--url', url, ...at] : ['tab', 'switch', '--page', tab, '--focus', ...at], { timeout: 60_000 }, (error) => {
      if (error !== null && !error.killed) openInBrowser(url)
    })
  }

  const open = async (boxId: string): Promise<string | null> => {
    const listed = await state(true)
    if (listed.status !== 'ok') return listed.status === 'failed' ? listed.message : 'tesser is not installed'
    const box = cached?.boxes.find((row) => row.boxId === boxId)
    const url = box === undefined ? null : link(box, ports.byService)
    if (box === undefined || url === null) return `${boxId} has no dev server to open`
    const failed = box.power === 'asleep' ? await tesser(['wake', boxId]) : null
    if (failed === null) await show(url)
    return failed
  }

  const act = (action: (boxId: string) => Promise<string | null>) => async ({ boxId }: { boxId: string }): Promise<State> => {
    if (!BOX_ID.test(boxId)) throw new Error(`not a box id: ${boxId}`)
    const failed = await action(boxId)
    generation++
    return publish(await state(true, failed))
  }

  orca.panels.handle('tesser.state', async ({ fresh }) => {
    generation++
    return publish(await state(fresh))
  })
  orca.panels.handle('tesser.sleep', act((boxId) => tesser(['sleep', boxId, '--yes'])))
  orca.panels.handle('tesser.wake', act((boxId) => tesser(['wake', boxId])))
  orca.panels.handle('tesser.open', act(open))

  orca.commands.register('tesser.open', async () => {
    const next = await state(false)
    const box = next.status === 'ok' ? next.here.find((row) => row.url !== null) : undefined
    if (box === undefined) return 'This workspace has no tesser box with a dev server'
    const failed = await open(box.id)
    await refresh(true)
    return failed ?? box.url
  })

  orca.events.on('workspace.changed', () => void refresh(false))
  poll = setInterval(() => void refresh(true), POLL_MS)
  poll.unref()

  orca.events.on('workspace.removed', async ({ kind, path }) => {
    if (kind !== 'worktree' || (await orca.settings.get('removeBoxes')) === false || !(await deleted(path))) return
    const bin = await cli()
    const listed = await run(bin, ['ls', '--json'], 30_000, NO_TELEMETRY)
    if (!listed.ok) return orca.log(`${path} was deleted, but its boxes could not be listed: ${listed.said}`)
    const ids = orphaned(list(listed.stdout), canonical(path), existsSync)
    if (ids.length === 0) return
    const removed = await run(bin, ['rm', ...ids, '--yes'], 110_000)
    orca.log(removed.ok ? `removed ${ids.join(', ')}: ${path} was deleted` : `${path} was deleted, but ${ids.join(', ')} could not be removed: ${removed.said}`)
    await refresh(true)
  })
}
