import { randomUUID } from "node:crypto"

import {
  appendSessionEntry,
  getCurrentSession,
  loadUserHistoryEntries,
  type SessionHistoryEntry,
} from "./sessionHistory"

const MAX_HISTORY_ENTRIES = 1000

export interface HistoryMatch {
  value: string
  index: number
}

export class InteractiveHistory {
  private items: string[]
  private cursor: number | null
  private pendingEntries: SessionHistoryEntry[]

  private constructor(entries: string[]) {
    this.items = [...entries]
    this.cursor = null
    this.pendingEntries = []
  }

  static async load(): Promise<InteractiveHistory> {
    try {
      await getCurrentSession()
      const entries = await loadUserHistoryEntries(MAX_HISTORY_ENTRIES)
      return new InteractiveHistory(entries)
    } catch (error) {
      return new InteractiveHistory([])
    }
  }

  async persist(): Promise<void> {
    if (!this.pendingEntries.length) {
      return
    }

    const entriesToWrite = [...this.pendingEntries]
    this.pendingEntries = []

    try {
      for (const entry of entriesToWrite) {
        await appendSessionEntry(entry)
      }
    } catch (error) {
      this.pendingEntries = [...entriesToWrite, ...this.pendingEntries]
      throw error
    }
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
    this.pendingEntries.push({
      id: randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    })
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
