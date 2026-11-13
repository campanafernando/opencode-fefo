import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { delimiter, join, resolve } from "node:path"

export type FefoResult = {
  code: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export type FefoAddInput = {
  path: string
  role?: string
  name?: string
  stack?: string
  test?: string
  lint?: string
  build?: string
}

/**
 * How a FEFO subcommand may be reached through the agent tools.
 * - read: no side effects, runs freely.
 * - write: changes the workspace; the plugin asks for permission first.
 * - terminal: not available to the agent (`init`, `mcp add`, unknown input). `mcp add --local`
 *   registers a command that OpenCode then starts, so it must be typed by a person.
 */
export type Access = "read" | "write" | "terminal"

export function classify(args: string[]): Access {
  const [command, sub] = args
  switch (command) {
    case "status":
    case "doctor":
      return "read"
    case "sync":
    case "adapters":
      return args.includes("--check") ? "read" : "write"
    case "index":
    case "add":
    case "remove":
      return "write"
    case "mcp":
      if (sub === "list") return "read"
      if (sub === "remove") return "write"
      return "terminal"
    default:
      return "terminal"
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

const found = new Map<string, string>()

export function clearFefoCache(): void {
  found.clear()
}

export function findFefo(directory: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = `${directory}\0${env.FEFO_CLI ?? ""}\0${env.PATH ?? ""}`
  const cached = found.get(key)
  if (cached && isExecutable(cached)) return cached

  const candidates = [
    env.FEFO_CLI,
    join(directory, "bin", "fefo"),
    join(directory, ".fefo", "bin", "fefo"),
  ].filter((value): value is string => Boolean(value))

  const match = candidates.map((candidate) => resolve(candidate)).find(isExecutable) ?? onPath("fefo", env)
  if (match) found.set(key, match)
  return match
}

export function timeoutFor(args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.FEFO_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) return configured
  return args[0] === "index" || args[0] === "add" ? 900_000 : 120_000
}

export function runFefo(
  cli: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs: number = timeoutFor(args),
): Promise<FefoResult> {
  return new Promise((resolvePromise) => {
    // Own process group, so a timeout or abort also stops whatever the CLI spawned
    // (codegraph, git); a child holding the pipes open would otherwise keep us waiting.
    const child = spawn(cli, args, {
      cwd,
      env: process.env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    const terminate = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM")
        else child.kill("SIGTERM")
      } catch {
        child.kill("SIGTERM")
      }
    }
    const finish = (result: FefoResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    const finishTimedOut = () =>
      finish({
        code: 124,
        stdout,
        stderr: `${stderr}FEFO timed out after ${Math.round(timeoutMs / 1000)}s (set FEFO_TIMEOUT_MS to change).`,
        timedOut: true,
      })
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
      setTimeout(finishTimedOut, 1000).unref()
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      finish({ code: 127, stdout, stderr: `${stderr}${String(error)}` })
    })
    child.on("exit", () => {
      if (timedOut) finishTimedOut()
    })
    child.on("close", (code) => {
      if (timedOut) finishTimedOut()
      else finish({ code: code ?? 1, stdout, stderr })
    })

    if (signal) {
      if (signal.aborted) terminate()
      else signal.addEventListener("abort", terminate, { once: true })
    }
  })
}

const MAX_OUTPUT = 20_000

export function formatResult(result: FefoResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n")
  const text = output || `FEFO exited with code ${result.code}`
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… output truncated` : text
}

export function addArgs(input: FefoAddInput): string[] {
  const args = ["add", input.path]
  if (input.name) args.push("--name", input.name)
  if (input.role) args.push("--role", input.role)
  if (input.stack) args.push("--stack", input.stack)
  if (input.test) args.push("--test", input.test)
  if (input.lint) args.push("--lint", input.lint)
  if (input.build) args.push("--build", input.build)
  return args
}

export function splitCommand(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (escaping) current += "\\"
  if (current) args.push(current)
  return args
}
