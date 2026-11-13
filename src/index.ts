import { Plugin } from "@opencode/plugin"
import { addArgs, classify, findFefo, formatResult, runFefo, splitCommand, type FefoAddInput } from "./fefo.js"

const MISSING =
  "FEFO CLI not found. Clone https://github.com/campanafernando/FEFO, run `./bin/fefo init`, " +
  "or point FEFO_CLI to the executable."

// Namespaced so the tools are fefo_status, fefo_sync, ... and cannot collide with other plugins.
const TOOL_OPTIONS = { namespace: "fefo" } as const

const emptyInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

const checkInput = {
  type: "object",
  properties: {
    check: { type: "boolean", description: "Only report what is out of date; write nothing." },
  },
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

    // Agent-initiated calls: reads run freely, writes ask first, the rest stays in the terminal.
    async function guarded(args: string[], context: ToolCall) {
      const access = classify(args)
      if (access === "terminal") {
        return `\`fefo ${args.join(" ")}\` is not available to the agent. Run it yourself in a terminal: ./bin/fefo ${args.join(" ")}`
      }
      if (access === "write") {
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: "fefo",
          resources: [args.join(" ")],
          save: [`${args[0]}*`],
        })
      }
      return execute(args, context.signal)
    }

    await ctx.command.transform((editor) => {
      editor.add({
        name: "fefo",
        description: "Run a FEFO workspace command (add, sync, index, status, doctor, adapters, mcp)",
        // A person typed this, so every subcommand is allowed. The output is posted as a
        // synthetic message: it is context for the session, not a new user prompt.
        execute: async ({ sessionID, prompt }) => {
          const args = splitCommand(prompt.text)
          const output = await execute(args.length ? args : ["status"])
          await ctx.session.synthetic({ sessionID, text: output })
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
        options: TOOL_OPTIONS,
        description: "Show federated repositories, roles, stacks, and CodeGraph index status.",
        input: emptyInput,
        execute: async (_input, context) => ({ content: await guarded(["status"], context) }),
      })

      editor.add({
        name: "sync",
        options: TOOL_OPTIONS,
        description:
          "Regenerate OpenCode config, MCP config, vault summaries, and Claude/Cursor/Copilot adapters. " +
          "Pass check=true to only report drift without writing (no approval needed).",
        input: checkInput,
        execute: async (input, context) => {
          const check = (input as { check?: boolean }).check === true
          return { content: await guarded(check ? ["sync", "--check"] : ["sync"], context) }
        },
      })

      editor.add({
        name: "doctor",
        options: TOOL_OPTIONS,
        description: "Validate the FEFO manifest, generated files, agents, repositories, and CodeGraph indexes.",
        input: emptyInput,
        execute: async (_input, context) => ({ content: await guarded(["doctor"], context) }),
      })

      editor.add({
        name: "index",
        options: TOOL_OPTIONS,
        description: "Refresh CodeGraph indexes for all or selected federated repositories. Asks for approval.",
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
          return { content: await guarded(["index", ...names], context) }
        },
      })

      editor.add({
        name: "add",
        options: TOOL_OPTIONS,
        description: "Add or update a repository in the FEFO federation. Asks for approval.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the repository." },
            role: { type: "string", description: "Repository role, such as api, web, data, or infra." },
            name: { type: "string", description: "Short repository name." },
            stack: { type: "string", description: "Stack override, such as django, next, nest, or flutter." },
            test: { type: "string", description: "Test command override." },
            lint: { type: "string", description: "Lint command override." },
            build: { type: "string", description: "Build command override." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input, context) => ({ content: await guarded(addArgs(input as FefoAddInput), context) }),
      })

      editor.add({
        name: "run",
        options: TOOL_OPTIONS,
        description:
          "Run a FEFO CLI command. Read-only subcommands (status, doctor, sync --check, adapters --check, mcp list) " +
          "run directly; sync, adapters, index, add, remove and mcp remove ask for approval; init and mcp add are " +
          "refused and must be run in a terminal.",
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
          const args = [...(input as { args: string[] }).args]
          while (args[0] === "--" || args[0] === "fefo") args.shift()
          return { content: await guarded(args, context) }
        },
      })
    })
  },
})

// Branded IDs from the SDK are plain strings at runtime and assignable to string.
type ToolCall = {
  signal: AbortSignal
  sessionID: string
  agent: string
  messageID: string
  id: string
}
