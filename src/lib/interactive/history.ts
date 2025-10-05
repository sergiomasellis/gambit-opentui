import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { workspaceRoot } from "../../config"

const HISTORY_FILENAME = "history.json"
const HISTORY_DIRECTORY = path.join(workspaceRoot, ".gambit")
const HISTORY_PATH = path.join(HISTORY_DIRECTORY, HISTORY_FILENAME)

interface SerializedHistory {
  entries: string[]
}

export interface HistoryMatch {
  value: string
  index: number
}

export class InteractiveHistory {
  private items: string[]
  private cursor: number | null

  constructor(entries: string[]) {
    this.items = [...entries]
    this.cursor = null
  }

  static async load(): Promise<InteractiveHistory> {
    try {
      const content = await readFile(HISTORY_PATH, "utf8")
      const parsed = JSON.parse(content) as SerializedHistory
      if (Array.isArray(parsed.entries)) {
        return new InteractiveHistory(parsed.entries.filter((entry) => typeof entry === "string"))
      }
    } catch (error) {
      // ignore missing or malformed history files; start with empty history
    }
    return new InteractiveHistory([])
  }

  async persist(): Promise<void> {
    const payload: SerializedHistory = { entries: this.items.slice(-1000) }
    await mkdir(HISTORY_DIRECTORY, { recursive: true })
    await writeFile(HISTORY_PATH, JSON.stringify(payload, null, 2), "utf8")
  }

  add(entry: string): void {
    const trimmed = entry.trim()
    if (!trimmed) {
      return
    }
    const last = this.items[this.items.length - 1]
    if (last === trimmed) {
      return
    }
    this.items.push(trimmed)
    this.cursor = null
  }

  clearCursor(): void {
    this.cursor = null
  }

  previous(currentInput: string): string | null {
    if (!this.items.length) {
      return null
    }
    if (this.cursor === null) {
      this.cursor = this.items.length - 1
      return this.items[this.cursor] ?? currentInput
    }
    if (this.cursor === 0) {
      return this.items[this.cursor]
    }
    this.cursor -= 1
    return this.items[this.cursor]
  }

  next(): string | null {
    if (this.cursor === null) {
      return null
    }
    if (this.cursor >= this.items.length - 1) {
      this.cursor = null
      return ""
    }
    this.cursor += 1
    return this.items[this.cursor]
  }

  findLatestMatch(query: string, fromIndex: number = this.items.length - 1): HistoryMatch | null {
    if (!query) {
      return null
    }
    const lower = query.toLowerCase()
    for (let index = Math.min(fromIndex, this.items.length - 1); index >= 0; index -= 1) {
      const value = this.items[index]
      if (value.toLowerCase().includes(lower)) {
        return { value, index }
      }
    }
    return null
  }

  get size(): number {
    return this.items.length
  }

  get all(): string[] {
    return [...this.items]
  }
}
