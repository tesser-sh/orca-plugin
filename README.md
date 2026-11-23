# Tesser for Orca

The [tesser](https://tesser.sh) box behind each Orca workspace. Your code stays in the workspace; the box runs it.

- A sidebar panel with this workspace's boxes: awake or asleep, and the localhost link to the dev server.
- Open wakes the box if it is asleep and shows its app in an Orca browser tab, next to your agent.
- A status bar item for the workspace you are in.
- Deleting a workspace removes the boxes only it used. Turn this off in the plugin's settings.

## Requirements

- Orca 1.4.256 or later
- The tesser CLI, signed in: `curl -fsSL https://tesser.sh/install | sh`, then `tesser login`

Start a box from the workspace's terminal with `tesser dev`, or ask your agent to.
