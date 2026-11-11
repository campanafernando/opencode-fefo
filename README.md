# opencode-fefo

OpenCode plugin for [FEFO](https://github.com/campanafernando/FEFO) workspaces.

It adds a `/fefo` command and a set of tools that operate on the FEFO workspace
from inside OpenCode:

- `fefo_status`
- `fefo_sync`
- `fefo_doctor`
- `fefo_index`
- `fefo_add`
- `fefo_run`

The plugin is a thin bridge. It calls the `fefo` CLI that lives in the workspace
(`bin/fefo`), on `PATH`, or at `FEFO_CLI`.

## Install

OpenCode 2.2.7+ is required.

> npm publication is pending. Until then, load the plugin from a local checkout.

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-fefo"]
}
```

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

Or ask the agent to use the `fefo_*` tools directly.

`/fefo` is intentionally a thin wrapper: it runs the CLI and returns the output
to the session. It does not duplicate the FEFO generator.

## zsh integration

[`opencode-zshell`](https://github.com/campanafernando/opencode-zshell) calls the
same plugin/CLI so the commands work from a terminal and from OpenCode.

## Development

```sh
bun install
bun run typecheck
bun test
```

## License

MIT. See [`LICENSE`](LICENSE).
