import { defineCheck } from 'orca/testing'
import type { State } from './protocol.ts'

const answers = (state: State) => ({ requests: { 'tesser.state': () => state } })

export default defineCheck({
  boxes: answers({
    status: 'ok',
    workspace: 'checkout-redesign',
    failed: null,
    here: [
      { id: 'box_3f9a1c07d2e84b65', name: 'web', size: 'standard', power: 'awake', url: 'http://box-3f9a1c07d2e84b65.localhost:3000' },
      { id: 'box_b71e40c9a8d3f216', name: 'api', size: 'small', power: 'asleep', url: 'http://box-b71e40c9a8d3f216.localhost:8080' },
    ],
    elsewhere: [{ id: 'box_41c09d2e77ab3f10', name: 'web', size: 'standard', power: 'asleep', url: 'http://box-41c09d2e77ab3f10.localhost:3000', worktree: 'fix-login' }],
  }),
  empty: answers({ status: 'ok', workspace: 'checkout-redesign', failed: null, here: [], elsewhere: [] }),
  uninstalled: answers({ status: 'no-cli' }),
  failed: answers({ status: 'failed', message: 'tesser: no org selected\n  run `tesser login` (or `tesser org use <org_id>` for an org you are already logged in to)' }),
})
