import { describe, expect, test } from "bun:test"
import { addArgs, splitCommand } from "../src/fefo.js"

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
