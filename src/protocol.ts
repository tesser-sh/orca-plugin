import type { Box, Elsewhere } from './boxes.ts'

export type State =
  | { status: 'ok'; workspace: string | null; here: Box[]; elsewhere: Elsewhere[]; outdated: boolean; failed: string | null }
  | { status: 'no-cli' }
  | { status: 'failed'; message: string }

declare module 'orca' {
  interface PluginRequests {
    'tesser.state': { input: { fresh: boolean }; output: State }
    'tesser.sleep': { input: { boxId: string }; output: State }
    'tesser.wake': { input: { boxId: string }; output: State }
    'tesser.open': { input: { boxId: string }; output: State }
  }
  interface PluginPanelEvents {
    'tesser.changed': State
  }
}
