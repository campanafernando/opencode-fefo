import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addArgs,
  classify,
  clearFefoCache,
  findFefo,
  formatResult,
  runFefo,
  splitCommand,
  timeoutFor,
} from "../src/fefo.js"
import plugin from "../src/index.js"

describe("splitCommand", () => {
  test("splits simple arguments", () => {
    expect(splitCommand("add ../api --role api")).toEqual(["add", "../api", "--role", "api"])
  })

  test("keeps quoted paths together", () => {
    expect(splitCommand('add "../my api" --name api')).toEqual(["add", "../my api", "--name", "api"])
  })

  test("handles empty input", () => {
    expect(splitCommand("   ")).toEqual([])
  })
})

describe("addArgs", () => {
  test("builds the CLI arguments", () => {
    expect(addArgs({ path: "../api", role: "api", name: "api" })).toEqual([
      "add", "../api", "--name", "api", "--role", "api",
    ])
  })
})

describe("classify", () => {
  test("read-only subcommands run freely", () => {
    for (const args of [["status"], ["doctor"], ["sync", "--check"], ["adapters", "--check"], ["mcp", "list"]]) {
      expect(classify(args)).toBe("read")
    }
  })

  test("workspace-changing subcommands ask first", () => {
    for (const args of [["sync"], ["adapters"], ["index"], ["index", "api"], ["add", "../x"], ["remove", "x"], ["mcp", "remove", "x"]]) {
      expect(classify(args)).toBe("write")
    }
  })

  test("init, mcp add and unknown input stay in the terminal", () => {
    for (const args of [["init", "--force"], ["mcp", "add", "x", "--local", "--", "sh", "-c", "id"], ["mcp"], ["rm", "-rf", "/"], []]) {
      expect(classify(args)).toBe("terminal")
    }
  })
})

describe("with a fake FEFO CLI", () => {
  let dir: string
  beforeEach(() => {
    clearFefoCache()
    dir = mkdtempSync(join(tmpdir(), "fefo-plugin-"))
    mkdirSync(join(dir, "bin"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function fakeCli(body: string) {
    const path = join(dir, "bin", "fefo")
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }

  test("findFefo prefers FEFO_CLI, then bin/fefo, then PATH, and ignores non-executables", () => {
    const cli = fakeCli("echo ok")
    expect(findFefo(dir, { PATH: "" })).toBe(cli)
    expect(findFefo(dir, { FEFO_CLI: cli, PATH: "" })).toBe(cli)
    chmodSync(cli, 0o644)
    clearFefoCache()
    expect(findFefo(dir, { PATH: "" })).toBeUndefined()
    const onPath = mkdtempSync(join(tmpdir(), "fefo-path-"))
    const bin = join(onPath, "fefo")
    writeFileSync(bin, "#!/bin/sh\n")
    chmodSync(bin, 0o755)
    expect(findFefo(dir, { PATH: onPath })).toBe(bin)
    rmSync(onPath, { recursive: true, force: true })
  })

  test("runFefo captures output and exit code", async () => {
    const cli = fakeCli('echo "args: $*"; echo oops >&2; exit 3')
    const result = await runFefo(cli, ["status"], dir)
    expect(result.code).toBe(3)
    expect(result.stdout).toContain("args: status")
    expect(formatResult(result)).toContain("oops")
  })

  test("runFefo kills a hung CLI after the timeout", async () => {
    const cli = fakeCli("sleep 30")
    const result = await runFefo(cli, ["index"], dir, undefined, 150)
    expect(result.timedOut).toBe(true)
    expect(result.code).toBe(124)
    expect(result.stderr).toContain("timed out")
  })

  test("timeoutFor allows index longer and honors FEFO_TIMEOUT_MS", () => {
    expect(timeoutFor(["index"], {})).toBeGreaterThan(timeoutFor(["status"], {}))
    expect(timeoutFor(["status"], { FEFO_TIMEOUT_MS: "5000" })).toBe(5000)
  })
})

describe("plugin wiring", () => {
  // Minimal stand-in for the OpenCode plugin context: records what the plugin registers and calls.
  function harness(directory: string) {
    const commands: Record<string, (input: any) => Promise<void>> = {}
    const tools: Record<string, (input: any, context: any) => Promise<{ content: string }>> = {}
    const toolOptions: Record<string, any> = {}
    const asserted: any[] = []
    const synthetic: any[] = []
    const prompts: any[] = []
    const ctx: any = {
      location: { directory },
      command: { transform: async (cb: any) => cb({ add: (c: any) => (commands[c.name] = c.execute) }) },
      tool: { transform: async (cb: any) => cb({ namespace() {}, add: (t: any) => ((tools[t.name] = t.execute), (toolOptions[t.name] = t.options)) }) },
      permission: { assert: async (input: any) => void asserted.push(input) },
      session: {
        synthetic: async (input: any) => void synthetic.push(input),
        prompt: async (input: any) => void prompts.push(input),
      },
    }
    return { ctx, commands, tools, toolOptions, asserted, synthetic, prompts }
  }

  let dir: string
  beforeEach(() => {
    clearFefoCache()
    dir = mkdtempSync(join(tmpdir(), "fefo-plugin-"))
    mkdirSync(join(dir, "bin"))
    const cli = join(dir, "bin", "fefo")
    writeFileSync(cli, '#!/bin/sh\necho "ran: $*"\n')
    chmodSync(cli, 0o755)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const call = { signal: new AbortController().signal, sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1" }

  test("registers the command and every tool", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    expect(Object.keys(h.commands)).toEqual(["fefo"])
    expect(Object.keys(h.tools).sort()).toEqual(["add", "doctor", "index", "run", "status", "sync"])
  })

  test("every tool is namespaced so it cannot collide (fefo_status, not status)", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    for (const name of Object.keys(h.tools)) expect(h.toolOptions[name]).toMatchObject({ namespace: "fefo" })
  })

  test("/fefo posts the CLI output as a synthetic message, never as a user prompt", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    await h.commands.fefo({ sessionID: "ses_1", prompt: { text: "status" } })
    expect(h.synthetic).toEqual([{ sessionID: "ses_1", text: "ran: status" }])
    expect(h.prompts).toEqual([])
  })

  test("/fefo with no arguments runs status", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    await h.commands.fefo({ sessionID: "ses_1", prompt: { text: "" } })
    expect(h.synthetic[0].text).toBe("ran: status")
  })

  test("read-only tool calls do not ask for permission", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    expect((await h.tools.status({}, call)).content).toBe("ran: status")
    expect((await h.tools.sync({ check: true }, call)).content).toBe("ran: sync --check")
    expect((await h.tools.run({ args: ["fefo", "mcp", "list"] }, call)).content).toBe("ran: mcp list")
    expect(h.asserted).toEqual([])
  })

  test("writing tool calls assert permission before running", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    expect((await h.tools.sync({}, call)).content).toBe("ran: sync")
    expect((await h.tools.index({ names: ["api"] }, call)).content).toBe("ran: index api")
    expect((await h.tools.add({ path: "../x" }, call)).content).toBe("ran: add ../x")
    expect(h.asserted.map((a) => a.resources[0])).toEqual(["sync", "index api", "add ../x"])
    expect(h.asserted[0]).toMatchObject({ action: "fefo", sessionID: "ses_1", agent: "build", source: { type: "tool", id: "call_1" } })
  })

  test("a denied permission stops the command from running", async () => {
    const h = harness(dir)
    h.ctx.permission.assert = async () => {
      throw new Error("rejected")
    }
    await plugin.setup(h.ctx)
    await expect(h.tools.sync({}, call)).rejects.toThrow("rejected")
  })

  test("init and mcp add are refused for the agent and never reach the CLI", async () => {
    const h = harness(dir)
    await plugin.setup(h.ctx)
    const init = await h.tools.run({ args: ["init", "--force"] }, call)
    const mcp = await h.tools.run({ args: ["mcp", "add", "x", "--local", "--", "sh", "-c", "id"] }, call)
    expect(init.content).toContain("not available to the agent")
    expect(mcp.content).toContain("not available to the agent")
    expect(h.asserted).toEqual([])
  })

  test("reports a missing CLI", async () => {
    const h = harness(mkdtempSync(join(tmpdir(), "fefo-empty-")))
    const saved = process.env.PATH
    process.env.PATH = ""
    try {
      await plugin.setup(h.ctx)
      expect((await h.tools.status({}, call)).content).toContain("FEFO CLI not found")
    } finally {
      process.env.PATH = saved
    }
  })
})
