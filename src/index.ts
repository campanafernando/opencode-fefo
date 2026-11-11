import { Plugin } from "@opencode/plugin"
import { addArgs, findFefo, formatResult, runFefo, splitCommand } from "./fefo.js"

const MISSING =
  "FEFO CLI not found. Clone https://github.com/campanafernando/FEFO, run `./bin/fefo init`, " +
  "or point FEFO_CLI to the executable."

const emptyInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

export default Plugin.define({
  id: "fefo",
  async setup(ctx) {
    const directory = ctx.location?.directory ?? process.cwd()

    async function execute(args: string[], signal?: AbortSignal) {
      const cli = findFefo(directory)
      if (!cli) return MISSING
      return formatResult(await runFefo(cli, args, directory, signal))
    }

    await ctx.command.transform((editor) => {
      editor.add({
        name: "fefo",
        description: "Run a FEFO workspace command (add, sync, index, status, doctor, mcp)",
        execute: async ({ sessionID, prompt }) => {
          const args = splitCommand(prompt.text)
          const output = await execute(args.length ? args : ["status"])
          await ctx.session.prompt({ sessionID, text: output })
        },
      })
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "fefo",
        description: "FEFO federated workspace tools",
      })

      editor.add({
        name: "status",
        description: "Show federated repositories, roles, stacks, and CodeGraph index status.",
        input: emptyInput,
        execute: async (_input, context) => ({ content: await execute(["status"], context.signal) }),
      })

      editor.add({
        name: "sync",
        description: "Regenerate OpenCode config, MCP config, vault summaries, and Claude/Cursor/Copilot adapters.",
        input: emptyInput,
        execute: async (_input, context) => ({ content: await execute(["sync"], context.signal) }),
      })

      editor.add({
        name: "doctor",
        description: "Validate the FEFO manifest, generated files, repositories, and CodeGraph indexes.",
        input: emptyInput,
        execute: async (_input, context) => ({ content: await execute(["doctor"], context.signal) }),
      })

      editor.add({
        name: "index",
        description: "Refresh CodeGraph indexes for all or selected federated repositories.",
        input: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "Repository names; omit for all.",
            },
          },
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const names = (input as { names?: string[] }).names ?? []
          return { content: await execute(["index", ...names], context.signal) }
        },
      })

      editor.add({
        name: "add",
        description: "Add or update a repository in the FEFO federation.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the repository." },
            role: { type: "string", description: "Repository role, such as api, web, data, or infra." },
            name: { type: "string", description: "Short repository name." },
            stack: { type: "string", description: "Stack override, such as django, next, or flutter." },
            test: { type: "string", description: "Test command override." },
            lint: { type: "string", description: "Lint command override." },
            build: { type: "string", description: "Build command override." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const args = addArgs(input as { path: string; role?: string; name?: string; stack?: string; test?: string; lint?: string; build?: string })
          return { content: await execute(args, context.signal) }
        },
      })

      editor.add({
        name: "run",
        description: "Run an arbitrary FEFO CLI command. The allowed subcommands are init, add, remove, sync, index, status, doctor, and mcp.",
        input: {
          type: "object",
          properties: {
            args: {
              type: "array",
              items: { type: "string" },
              description: "Arguments passed to the FEFO CLI.",
            },
          },
          required: ["args"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const raw = (input as { args: string[] }).args
          const args = [...raw]
          while (args[0] === "--" || args[0] === "fefo") args.shift()
          return { content: await execute(args, context.signal) }
        },
      })
    })
  },
})
