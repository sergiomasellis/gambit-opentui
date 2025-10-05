import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useKeyboard, useAppContext } from "@opentui/react"
import type { ParsedKey } from "@opentui/core"

import type { UIMessage } from "../../types/chat"
import { InteractiveHistory } from "./history"
import { InteractiveSession, type PermissionMode } from "./session"
import { matchShortcut } from "./shortcuts"

type SubmitOptions = {
  signal: AbortSignal
}

export interface UseInteractiveControllerOptions {
  inputValue: string
  setInputValue: Dispatch<SetStateAction<string>>
  messages: UIMessage[]
  setMessages: Dispatch<SetStateAction<UIMessage[]>>
  isRunning: boolean
  performSubmit: (value: string, options: SubmitOptions) => Promise<void>
  onAbort?: () => void
  onRewind?: () => void
  onBackgroundRequest?: (command: string) => boolean
}

interface HistorySearchState {
  active: boolean
  query: string
  match: string | null
}

export interface UseInteractiveControllerResult {
  thinkingEnabled: boolean
  permissionMode: PermissionMode
  historySearch: HistorySearchState
  handleSubmit: (value: string) => Promise<void>
  handleInput: (value: string) => void
  exitHistorySearch: () => void
}

const DOUBLE_ESC_INTERVAL_MS = 400

const isPrintableKey = (key: ParsedKey): boolean => {
  if (key.ctrl || key.meta) {
    return false
  }
  return key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32
}

export function useInteractiveController({
  inputValue,
  setInputValue,
  messages,
  setMessages,
  isRunning,
  performSubmit,
  onAbort,
  onRewind,
  onBackgroundRequest,
}: UseInteractiveControllerOptions): UseInteractiveControllerResult {
  const sessionRef = useRef(new InteractiveSession())
  const historyRef = useRef<InteractiveHistory | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historySearch, setHistorySearch] = useState<HistorySearchState>({ active: false, query: "", match: null })
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("normal")
  const lastEscTimestamp = useRef<number | null>(null)
  const lastSearchIndex = useRef<number | null>(null)
  const { renderer } = useAppContext()

  useEffect(() => {
    let cancelled = false
    InteractiveHistory.load().then((history) => {
      if (!cancelled) {
        historyRef.current = history
        setHistoryLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const persistHistory = useCallback(async () => {
    try {
      await historyRef.current?.persist()
    } catch (error) {
      console.warn("Failed to persist history", error)
    }
  }, [])

  const exitHistorySearch = useCallback(() => {
    setHistorySearch({ active: false, query: "", match: null })
    lastSearchIndex.current = null
  }, [])

  const handleSubmit = useCallback(
    async (value: string) => {
      const session = sessionRef.current

      if (value.endsWith("\\")) {
        setInputValue(`${value.slice(0, -1)}\n`)
        return
      }

      const trimmed = value.trim()
      if (!trimmed) {
        setInputValue("")
        return
      }

      if (!historyLoaded || !historyRef.current) {
        const history = await InteractiveHistory.load()
        historyRef.current = history
        setHistoryLoaded(true)
      }

      historyRef.current?.clearCursor()
      historyRef.current?.add(trimmed)
      await persistHistory()

      session.pushSnapshot(messages)
      const signal = session.startRun()

      try {
        await performSubmit(value, { signal })
      } finally {
        session.clearRun()
      }
    },
    [historyLoaded, messages, performSubmit, persistHistory, setInputValue],
  )

  const handleInput = useCallback(
    (value: string) => {
      if (historySearch.active) {
        return
      }
      historyRef.current?.clearCursor()
      setInputValue(value)
    },
    [historySearch.active, setInputValue],
  )

  const handleHistoryNavigation = useCallback(
    (direction: "previous" | "next") => {
      const history = historyRef.current
      if (!history) {
        return
      }

      if (direction === "previous") {
        const nextValue = history.previous(inputValue)
        if (nextValue !== null) {
          setInputValue(nextValue)
        }
        return
      }

      const nextValue = history.next()
      if (nextValue !== null) {
        setInputValue(nextValue)
      }
    },
    [inputValue, setInputValue],
  )

  const updateHistorySearch = useCallback(
    (query: string, advanced: boolean = false) => {
      const history = historyRef.current
      if (!history) {
        setHistorySearch({ active: true, query, match: null })
        return
      }

      const startIndex = advanced
        ? Math.max((lastSearchIndex.current ?? history.size) - 1, 0)
        : history.size - 1

      const match = history.findLatestMatch(query, startIndex)
      lastSearchIndex.current = match ? match.index : null
      setHistorySearch({ active: true, query, match: match?.value ?? null })

      if (match?.value) {
        setInputValue(match.value)
      }
    },
    [setInputValue],
  )

  const handleEscape = useCallback(() => {
    if (historySearch.active) {
      exitHistorySearch()
      return
    }

    const now = Date.now()
    if (lastEscTimestamp.current && now - lastEscTimestamp.current <= DOUBLE_ESC_INTERVAL_MS) {
      const snapshot = sessionRef.current.popSnapshot()
      if (snapshot) {
        setMessages(snapshot)
        onRewind?.()
      }
      lastEscTimestamp.current = null
      return
    }

    lastEscTimestamp.current = now
  }, [exitHistorySearch, historySearch.active, setMessages])

  const handleShortcut = useCallback(
    (key: ParsedKey) => {
      const match = matchShortcut(key)
      if (!match) {
        return false
      }

      switch (match.action) {
        case "abort-run": {
          sessionRef.current.abortRun()
          onAbort?.()
          return match.preventDefault ?? false
        }
        case "exit-session": {
          sessionRef.current.abortRun()
          setTimeout(() => {
            process.exit(0)
          }, 10)
          return match.preventDefault ?? false
        }
        case "clear-screen": {
          console.clear()
          try {
            renderer?.console?.clear()
          } catch (error) {
            // ignore renderer errors
          }
          return match.preventDefault ?? false
        }
        case "history-search": {
          if (!historySearch.active) {
            updateHistorySearch("")
          } else {
            updateHistorySearch(historySearch.query, true)
          }
          return match.preventDefault ?? false
        }
        case "history-previous": {
          if (!historySearch.active) {
            handleHistoryNavigation("previous")
          }
          return match.preventDefault ?? false
        }
        case "history-next": {
          if (!historySearch.active) {
            handleHistoryNavigation("next")
          }
          return match.preventDefault ?? false
        }
        case "toggle-thinking": {
          const enabled = sessionRef.current.toggleThinking()
          setThinkingEnabled(enabled)
          return match.preventDefault ?? false
        }
        case "cycle-permission": {
          const mode = sessionRef.current.cyclePermissionMode()
          setPermissionMode(mode)
          return match.preventDefault ?? false
        }
        case "newline": {
          setInputValue((prev) => `${prev}\n`)
          return match.preventDefault ?? false
        }
        case "background": {
          const trimmed = inputValue.trim()
          if (!trimmed) {
            return match.preventDefault ?? false
          }
          const handled = onBackgroundRequest ? onBackgroundRequest(trimmed) : false
          if (handled) {
            historyRef.current?.clearCursor()
            historyRef.current?.add(trimmed)
            void persistHistory()
            setInputValue("")
          }
          return match.preventDefault ?? false
        }
        default:
          return false
      }
    },
    [handleHistoryNavigation, historySearch, inputValue, onAbort, onBackgroundRequest, persistHistory, renderer, setInputValue, updateHistorySearch],
  )

  useKeyboard(
    useCallback(
      (key: ParsedKey) => {
        if (key.name === "escape") {
          handleEscape()
          return
        }

        if (historySearch.active) {
          if (key.name === "backspace") {
            const nextQuery = historySearch.query.slice(0, -1)
            updateHistorySearch(nextQuery)
            return
          }

          if (key.name === "r" && key.ctrl) {
            updateHistorySearch(historySearch.query, true)
            return
          }

          if (key.name === "return" || key.name === "enter") {
            exitHistorySearch()
            return
          }

          if (key.name === "c" && key.ctrl) {
            exitHistorySearch()
            return
          }

          if (isPrintableKey(key)) {
            const nextQuery = historySearch.query + key.sequence
            updateHistorySearch(nextQuery)
            return
          }
        }

        if (handleShortcut(key)) {
          return
        }
      },
      [exitHistorySearch, handleEscape, handleShortcut, historySearch, updateHistorySearch],
    ),
  )

  useEffect(() => {
    if (!isRunning) {
      sessionRef.current.clearRun()
    }
  }, [isRunning])

  return useMemo(
    () => ({
      thinkingEnabled,
      permissionMode,
      historySearch,
      handleSubmit,
      handleInput,
      exitHistorySearch,
    }),
    [exitHistorySearch, handleInput, handleSubmit, historySearch, permissionMode, thinkingEnabled],
  )
}
