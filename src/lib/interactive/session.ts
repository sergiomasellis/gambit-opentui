import type { UIMessage } from "../../types/chat"

export type PermissionMode = "normal" | "plan" | "auto-accept"

type Snapshot = {
  messages: UIMessage[]
}

const cloneMessages = (messages: UIMessage[]): UIMessage[] => {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(messages)
    }
  } catch (error) {
    // fall back to JSON clone below
  }
  return JSON.parse(JSON.stringify(messages)) as UIMessage[]
}

export class InteractiveSession {
  private thinking = false
  private permissionMode: PermissionMode = "normal"
  private abortController: AbortController | null = null
  private readonly snapshots: Snapshot[] = []
  private readonly maxSnapshots = 20

  get isThinkingEnabled(): boolean {
    return this.thinking
  }

  toggleThinking(): boolean {
    this.thinking = !this.thinking
    return this.thinking
  }

  get currentPermissionMode(): PermissionMode {
    return this.permissionMode
  }

  cyclePermissionMode(): PermissionMode {
    const next: Record<PermissionMode, PermissionMode> = {
      normal: "plan",
      plan: "auto-accept",
      "auto-accept": "normal",
    }
    this.permissionMode = next[this.permissionMode]
    return this.permissionMode
  }

  startRun(): AbortSignal {
    this.abortController?.abort()
    this.abortController = new AbortController()
    return this.abortController.signal
  }

  abortRun(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  clearRun(): void {
    this.abortController = null
  }

  pushSnapshot(messages: UIMessage[]): void {
    try {
      this.snapshots.push({ messages: cloneMessages(messages) })
      while (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.shift()
      }
    } catch {
      // best-effort snapshot; ignore failures
    }
  }

  popSnapshot(): UIMessage[] | null {
    if (!this.snapshots.length) {
      return null
    }
    const snapshot = this.snapshots.pop()
    if (!snapshot) {
      return null
    }
    try {
      return cloneMessages(snapshot.messages)
    } catch {
      return snapshot.messages.map((message) => ({ ...message }))
    }
  }
}
