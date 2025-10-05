import type { ParsedKey } from "@opentui/core"

export type ShortcutAction =
  | "abort-run"
  | "exit-session"
  | "clear-screen"
  | "history-search"
  | "history-previous"
  | "history-next"
  | "toggle-thinking"
  | "cycle-permission"
  | "newline"
  | "background"

export interface ShortcutMatch {
  action: ShortcutAction
  preventDefault?: boolean
}

export function matchShortcut(key: ParsedKey): ShortcutMatch | null {
  if (key.eventType === "release") {
    return null
  }

  switch (key.name) {
    case "c": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "abort-run", preventDefault: true }
      }
      break
    }
    case "d": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "exit-session", preventDefault: true }
      }
      break
    }
    case "l": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "clear-screen", preventDefault: true }
      }
      break
    }
    case "r": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-search", preventDefault: true }
      }
      break
    }
    case "up": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-previous", preventDefault: true }
      }
      break
    }
    case "down": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-next", preventDefault: true }
      }
      break
    }
    case "tab": {
      if (key.shift) {
        return { action: "cycle-permission", preventDefault: true }
      }
      if (!key.ctrl && !key.meta) {
        return { action: "toggle-thinking", preventDefault: true }
      }
      break
    }
    case "b": {
      if (key.ctrl && !key.meta && !key.shift) {
        return { action: "background", preventDefault: true }
      }
      break
    }
    case "return":
    case "enter": {
      if (key.ctrl || key.option || key.meta || key.shift) {
        return { action: "newline", preventDefault: true }
      }
      break
    }
    case "j": {
      if (key.ctrl && !key.meta && !key.shift) {
        return { action: "newline", preventDefault: true }
      }
      break
    }
    default:
      break
  }

  return null
}
