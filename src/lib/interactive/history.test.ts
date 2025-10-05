import { describe, expect, it } from "bun:test"

import { InteractiveHistory } from "./history"

describe("InteractiveHistory", () => {
  it("navigates backward and forward through history", () => {
    const history = new InteractiveHistory([])
    history.add("first command")
    history.add("second command")

    expect(history.previous("")).toBe("second command")
    expect(history.previous("")).toBe("first command")
    expect(history.previous("")).toBe("first command")
    expect(history.next()).toBe("second command")
    expect(history.next()).toBe("")
  })

  it("finds matches when searching backwards", () => {
    const history = new InteractiveHistory([
      "bun run build",
      "git status",
      "bun test",
      "git commit",
      "bun test --watch",
    ])

    const firstMatch = history.findLatestMatch("bun")
    expect(firstMatch?.value).toBe("bun test --watch")

    const earlierMatch = history.findLatestMatch("bun", (firstMatch?.index ?? 0) - 1)
    expect(earlierMatch?.value).toBe("bun test")
  })
})
