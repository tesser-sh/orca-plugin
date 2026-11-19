import { atom, Badge, Box as Frame, Button, Callout, Code, Collapsible, EmptyState, Heading, IconButton, Link, plugin, read, Row, set, Spinner, Stack, Text, type PanelContext } from 'orca'
import type { Box } from './boxes.ts'
import type { State } from './protocol.ts'

const state = atom<State | null>(null)
const busy = atom<string | null>(null)

function load(fresh: boolean): void {
  void plugin
    .request('tesser.state', { fresh })
    .then((next) => set(state, next))
    .catch((error: Error) => set(state, { status: 'failed', message: error.message }))
}

async function act(name: 'tesser.sleep' | 'tesser.wake' | 'tesser.open', boxId: string): Promise<void> {
  set(busy, boxId)
  try {
    set(state, await plugin.request(name, { boxId }, { timeoutMs: 120_000 }))
  } catch (error) {
    set(state, { status: 'failed', message: error instanceof Error ? error.message : String(error) })
  } finally {
    set(busy, null)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('tesser.changed', (next) => set(state, next)))
  load(false)
}

function tone(power: string): 'success' | 'accent' | 'warning' | 'neutral' {
  return power === 'awake' ? 'success' : power === 'waking' || power === 'launching' ? 'accent' : power === 'asleep' ? 'neutral' : 'warning'
}

function BoxRow({ box, worktree }: { box: Box; worktree?: string }) {
  const working = read(busy) === box.id
  const url = box.url
  return (
    <Frame border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="center">
        <Row gap="xs" align="center">
          <Text weight="medium">{worktree === undefined ? box.name : `${worktree} · ${box.name}`}</Text>
          <Badge tone={tone(box.power)}>{box.power}</Badge>
        </Row>
        <Text muted size="xs">
          {box.size}
        </Text>
      </Row>
      {url === null ? null : (
        <Row>
          <Link href={url}>{url.replace(/^http:\/\//, '')}</Link>
        </Row>
      )}
      <Row gap="xs" align="center">
        {url === null ? null : (
          <Button size="sm" icon="open-external" disabled={working} onPress={() => act('tesser.open', box.id)}>
            Open
          </Button>
        )}
        {box.power === 'awake' ? (
          <Button size="sm" variant="outline" icon="pause" disabled={working} onPress={() => act('tesser.sleep', box.id)}>
            Sleep
          </Button>
        ) : box.power === 'asleep' ? (
          <Button size="sm" variant="outline" icon="play" disabled={working} onPress={() => act('tesser.wake', box.id)}>
            Wake
          </Button>
        ) : null}
        {working ? <Spinner label="Working" labelHidden /> : null}
      </Row>
    </Frame>
  )
}

export default function Panel() {
  const current = read(state)
  if (current === null) return <Spinner label="Loading boxes" />
  if (current.status === 'no-cli') {
    return (
      <EmptyState icon="terminal" title="tesser is not installed">
        <Code block>curl -fsSL https://tesser.sh/install | sh</Code>
        <Button size="sm" variant="outline" icon="refresh" onPress={() => load(true)}>
          Check again
        </Button>
      </EmptyState>
    )
  }
  if (current.status === 'failed') {
    return (
      <Stack gap="sm">
        <Callout tone="danger">
          <Text>{current.message}</Text>
        </Callout>
        <Row>
          <Button size="sm" variant="outline" icon="refresh" onPress={() => load(true)}>
            Retry
          </Button>
        </Row>
      </Stack>
    )
  }
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading level={3}>{current.workspace ?? 'No workspace open'}</Heading>
        <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" onPress={() => load(true)} />
      </Row>
      {current.failed === null ? null : (
        <Callout tone="danger">
          <Text>{current.failed}</Text>
        </Callout>
      )}
      {current.outdated ? (
        <Callout tone="warning" title="Update tesser to open boxes from here">
          <Code>tesser update</Code>
        </Callout>
      ) : null}
      {current.here.length === 0 ? (
        <EmptyState icon="cloud" title="No box for this workspace">
          <Code>tesser dev</Code>
        </EmptyState>
      ) : (
        current.here.map((box) => <BoxRow key={box.id} box={box} />)
      )}
      {current.elsewhere.length === 0 ? null : (
        <Collapsible title={`Other workspaces (${current.elsewhere.length})`}>
          <Stack gap="sm">
            {current.elsewhere.map((box) => (
              <BoxRow key={box.id} box={box} worktree={box.worktree} />
            ))}
          </Stack>
        </Collapsible>
      )}
    </Stack>
  )
}
