# opencode-fefo

OpenCode plugin for [FEFO](https://github.com/campanafernando/FEFO) workspaces.

It adds a `/fefo` command and a set of tools that operate on the FEFO workspace
from inside OpenCode:

- `fefo_status`
- `fefo_sync` (`check: true` only reports drift)
- `fefo_doctor`
- `fefo_index`
- `fefo_add`
- `fefo_run`

The plugin is a thin bridge. It calls the `fefo` CLI that lives in the workspace
(`bin/fefo`), on `PATH`, or at `FEFO_CLI`.

## Permissions

Tool calls made by the agent are classified by subcommand:

| Access | Subcommands | Behavior |
|---|---|---|
| read | `status`, `doctor`, `sync --check`, `adapters --check`, `mcp list` | runs directly |
| write | `sync`, `adapters`, `index`, `add`, `remove`, `mcp remove` | asks first (`action: fefo`) |
| terminal | `init`, `mcp add`, anything unknown | refused; run it yourself |

`mcp add --local` registers a command that OpenCode then starts, so it is never
reachable through a tool. A FEFO-generated workspace adds the rule
`{ "action": "fefo", "resource": "*", "effect": "ask" }`; add your own rules to
allow specific commands (for example `fefo` / `sync*`).

`/fefo ...` is typed by a person, so every subcommand works there. Its output is
posted as a synthetic message (context for the session), not as a new user
prompt, so it does not start a model turn by itself.

A call that runs longer than 2 minutes (15 for `index` and `add`) is stopped with
its child processes; set `FEFO_TIMEOUT_MS` to change the limit.

## Install

OpenCode 2.3.0+ is required.

> npm publication is pending. Until then, load the plugin from a local checkout.

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-fefo"]
}
```

In a FEFO workspace, declare it in `.fefo/workspace.json` (`"plugins": ["..."]`) and run
`./bin/fefo sync`; the manifest value is merged into `opencode.json` and survives later syncs.

After publication:

```sh
opencode plugin add opencode-fefo
```

## FEFO CLI

The plugin needs a FEFO workspace. Either clone the template:

```sh
git clone https://github.com/campanafernando/FEFO.git my-workspace
cd my-workspace
./bin/fefo init --name "My Workspace" --repo ../api --repo ../web
```

or point `FEFO_CLI` at an existing executable:

```sh
export FEFO_CLI=/path/to/FEFO/bin/fefo
```

## Usage

Inside OpenCode:

```text
/fefo status
/fefo add ../worker --role data
/fefo index api web
/fefo doctor
```

Or ask the agent to use the `fefo_*` tools directly (in Code Mode they are `tools.fefo.status()`, `tools.fefo.sync()`, ...).

`/fefo` is intentionally a thin wrapper: it runs the CLI and returns the output
to the session. It does not duplicate the FEFO generator.

## zsh integration

[`opencode-zshell`](https://github.com/campanafernando/opencode-zshell) calls the
same plugin/CLI so the commands work from a terminal and from OpenCode.

## Verified against OpenCode 2.3.0

Besides the unit tests, the plugin was exercised live (`opencode run` and the HTTP API) in a
FEFO workspace that loads it through the manifest:

- read-only tools run, namespaced as `tools.fefo.*`;
- `fefo_sync` in a non-interactive run is rejected with `permission requested: fefo (sync); auto-rejecting`;
  with `--auto` it runs, because `--auto` approves everything that is not denied;
- `fefo_run` with `init` or `mcp add` returns the "not available to the agent" message and changes nothing;
- `/fefo status` (HTTP `session.command`) posts a `synthetic` message and does not start a model turn.

## Development

```sh
bun install
bun run typecheck
bun test
```

## License

MIT. See [`LICENSE`](LICENSE).
