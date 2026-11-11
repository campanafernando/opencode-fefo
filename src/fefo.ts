import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

export type FefoResult = {
  code: number
  stdout: string
  stderr: string
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

export function findFefo(directory: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env.FEFO_CLI,
    join(directory, "bin", "fefo"),
    join(directory, ".fefo", "bin", "fefo"),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate)
  }

  const which = spawnSync("sh", ["-lc", "command -v fefo"], { encoding: "utf8" })
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim()
  return undefined
}

export function runFefo(
  cli: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<FefoResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(cli, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: FefoResult) => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      finish({ code: 127, stdout, stderr: `${stderr}${String(error)}` })
    })
    child.on("close", (code) => {
      finish({ code: code ?? 1, stdout, stderr })
    })

    if (signal) {
      signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true })
    }
  })
}

export function formatResult(result: FefoResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n")
  if (output) return output
  return `FEFO exited with code ${result.code}`
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
