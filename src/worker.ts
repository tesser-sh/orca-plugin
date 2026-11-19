import { execFile, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { orphaned, parseBoxes, split, type LsBox } from './boxes.ts'
import type { State } from './protocol.ts'

const FRESH_MS = 15_000
const BOX_ID = /^box_[0-9a-f]+$/
const BOX_URL = /^http:\/\/[a-z0-9-]+\.localhost:\d+$/

interface Ran {
  ok: boolean
  missing: boolean
  stdout: string
  said: string
}

function run(cli: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(cli, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
  return parseBoxes(stdout).map((box) => ({
    ...box,
    url: typeof box.url === 'string' && !BOX_URL.test(box.url) ? null : box.url,
    worktrees: (box.worktrees ?? []).map((tree) => ({ ...tree, root: canonical(tree.root) })),
  }))
}

function tabOn(stdout: string, url: string): string | undefined {
  try {
    const tabs: { browserPageId: string; url: string }[] = JSON.parse(stdout).result?.tabs ?? []
    return tabs.find((tab) => tab.url.startsWith(url))?.browserPageId
  } catch {
    return undefined
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

export default function activate(orca: OrcaWorkerApi): void {
  let cached: { at: number; boxes: LsBox[] } | null = null
  let generation = 0

  const cli = async (): Promise<string> => {
    const set = await orca.settings.get('cli')
    if (typeof set === 'string' && set.trim() !== '') return set.trim()
    const installed = join(homedir(), '.tesser', 'bin', 'tesser')
    return existsSync(installed) ? installed : 'tesser'
  }

  const focused = async (): Promise<{ name: string; path: string; root: string } | null> => {
    const context = await orca.host.call('workspace.readContext', {})
    if (context === null) return null
    const { workspaces } = await orca.host.call('workspace.list', {})
    const local = workspaces.filter((row) => row.kind === 'worktree' && (row.hostId === null || row.hostId === 'local'))
    const id = (context as { id?: string }).id
    const byBranch = local.filter((row) => row.branch !== null && row.branch.replace(/^refs\/heads\//, '') === context.branch.replace(/^refs\/heads\//, ''))
    const hit = local.find((row) => row.id === id) ?? (byBranch.length === 1 ? byBranch[0] : byBranch.find((row) => row.name === context.displayName))
    return hit === undefined ? null : { name: context.displayName, path: hit.path, root: canonical(hit.path) }
  }

  const state = async (fresh: boolean, failed: string | null = null): Promise<State> => {
    if (fresh || cached === null || Date.now() - cached.at > FRESH_MS) {
      const ran = await run(await cli(), ['ls', '--json'], 30_000)
      if (ran.missing) return { status: 'no-cli' }
      if (!ran.ok) return { status: 'failed', message: ran.said }
      cached = { at: Date.now(), boxes: list(ran.stdout) }
    }
    const workspace = await focused()
    const outdated = cached.boxes.length > 0 && cached.boxes.every((box) => box.url === undefined)
    return { status: 'ok', workspace: workspace?.name ?? null, ...split(cached.boxes, workspace?.root ?? null), outdated, failed }
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
    if (workspace === null) return openInBrowser(url)
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
    if (box?.url == null) return `${boxId} has no dev server to open`
    const failed = box.power === 'asleep' ? await tesser(['wake', boxId]) : null
    if (failed === null) await show(box.url)
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

  orca.events.on('workspace.removed', async ({ kind, path }) => {
    if (kind !== 'worktree' || (await orca.settings.get('removeBoxes')) === false || !(await deleted(path))) return
    const bin = await cli()
    const listed = await run(bin, ['ls', '--json'], 30_000)
    if (!listed.ok) return orca.log(`${path} was deleted, but its boxes could not be listed: ${listed.said}`)
    const ids = orphaned(list(listed.stdout), canonical(path), existsSync)
    if (ids.length === 0) return
    const removed = await run(bin, ['rm', ...ids, '--yes'], 110_000)
    orca.log(removed.ok ? `removed ${ids.join(', ')}: ${path} was deleted` : `${path} was deleted, but ${ids.join(', ')} could not be removed: ${removed.said}`)
    await refresh(true)
  })
}
