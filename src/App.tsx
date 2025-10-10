import { TextAttributes, type ParsedKey, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { streamText } from "ai"
import { randomUUID } from "node:crypto"
import { useCallback, useEffect, useRef, useState } from "react"

import { defaultModel, MAX_SHELL_OUTPUT, workspaceRoot } from "./config"
import { formatToolEvent, toCoreMessages } from "./lib/messages"
import { createModelSelector, type ReasoningEffort } from "./lib/model"
import { useModelPicker } from "./lib/modelPicker"
import { truncate } from "./lib/text"
import { useInteractiveController } from "./lib/interactive/controller"
import { appendSessionEntry } from "./lib/interactive/sessionHistory"
import { loadSystemPrompt } from "./lib/prompt"
import { executeSlashCommand, type SlashCommandExecution } from "./lib/slashCommands"
import { appendMemoryEntry } from "./lib/memory"
import type { ModelListItem } from "./lib/openrouterModels"
import { theme, rolePresentation } from "./ui/theme"
import { Markdown } from "./ui/Markdown"
import { ModelPickerOverlay } from "./ui/model-picker/ModelPickerOverlay"
import type { UIMessage } from "./types/chat"
import type { ToolEventPayload } from "./types/tools"
import { agentTools } from "./tools"

const systemPrompt = await loadSystemPrompt()

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const formatTimestamp = (value: Date) => timestampFormatter.format(value)

const timestampLabels: Record<UIMessage["role"], string> = {
  system: "System",
  user: "Sent",
  assistant: "Responded",
  tool: "Tool event",
}

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }
  parts.push(`${seconds}s`)

  return parts.join(" ")
}

const initialSystemMessage: UIMessage = {
  id: randomUUID(),
  role: "system",
  content: systemPrompt,
  hidden: true,
  timestamp: new Date(),
}


interface BackgroundTask {
  id: string
  command: string
  status: "running" | "succeeded" | "failed"
  exitCode: number | null
  stdout: string
  stderr: string
  startedAt: Date
  finishedAt?: Date
}

function formatSlashCommandMessage(execution: SlashCommandExecution): string {
  const scopeLabel = execution.namespace ? `${execution.scope}:${execution.namespace}` : execution.scope
  const header: string[] = [`Command · ${execution.command}`, `Scope · ${scopeLabel}`]

  if (execution.arguments) {
    header.push(`Arguments · ${execution.arguments}`)
  }
  if (execution.allowedTools.length > 0) {
    header.push(`Allowed tools · ${execution.allowedTools.join(", ")}`)
  }
  if (execution.model) {
    header.push(`Preferred model · ${execution.model}`)
  }

  const headerBlock = header.join("\n")
  if (!execution.content) {
    return headerBlock
  }

  return `${headerBlock}\n\n${execution.content}`
}

export function App() {
  const [messages, setMessages] = useState<UIMessage[]>([initialSystemMessage])
  const [inputValue, setInputValue] = useState("")
  const [modelId, setModelId] = useState(defaultModel)
  const [apiKey, setApiKey] = useState<string>(Bun.env.OPENROUTER_API_KEY ?? "")
  const [status, setStatus] = useState<"idle" | "running">("idle")
  const [statusElapsed, setStatusElapsed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const thinkingEnabledRef = useRef(false)
  const statusStartedAtRef = useRef<Date | null>(null)
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null)
  const sanitizedApiKey = apiKey.trim()

  const handleModelSelection = useCallback(
    (model: ModelListItem, effort: ReasoningEffort | null) => {
      setModelId(model.id)
      setReasoningEffort(effort)
      setError(null)
      setMessages((prev) => [
        ...prev,
        {
          id: randomUUID(),
          role: "system",
          content: `Model set to ${model.id}${model.name && model.name !== model.id ? ` (${model.name})` : ""}${
            effort ? ` with ${effort} reasoning effort` : ""
          }.`,
          timestamp: new Date(),
        },
      ])
    },
    [setMessages],
  )

  const modelPicker = useModelPicker({
    apiKey: sanitizedApiKey.length > 0 ? sanitizedApiKey : null,
    currentModelId: modelId,
    currentReasoning: reasoningEffort,
    onSelect: handleModelSelection,
  })

  const {
    state: modelPickerState,
    open: openModelPicker,
    moveSelection: moveModelSelection,
    close: closeModelPicker,
    handleFilterChange: handleModelFilterChange,
    handleFilterSubmit,
    handleReasoningInput,
    handleReasoningSubmit,
    selectByIndex: selectModelByIndex,
    setSelection: setModelSelection,
  } = modelPicker

  useKeyboard(
    useCallback(
      (key: ParsedKey) => {
        if (!modelPickerState.isOpen) {
          return
        }

        if (key.name === "escape") {
          closeModelPicker()
          return
        }

        if (modelPickerState.mode === "list") {
          if (key.name === "up") {
            moveModelSelection(-1)
            return
          }
          if (key.name === "down") {
            moveModelSelection(1)
            return
          }
        }
      },
      [closeModelPicker, modelPickerState.isOpen, modelPickerState.mode, moveModelSelection],
    ),
  )

  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) {
      return
    }

    const viewportHeight = scrollbox.viewport.height ?? 0
    const maxScrollTop = Math.max(0, scrollbox.scrollHeight - viewportHeight)
    scrollbox.scrollTo(maxScrollTop)
  }, [messages])

  useEffect(() => {
    if (status !== "running") {
      statusStartedAtRef.current = null
      setStatusElapsed(null)
      return
    }

    statusStartedAtRef.current = new Date()
    setStatusElapsed(formatDuration(0))

    const intervalId = setInterval(() => {
      const startedAt = statusStartedAtRef.current
      if (!startedAt) {
        return
      }

      setStatusElapsed(formatDuration(Date.now() - startedAt.getTime()))
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [status])

  const runShellCommand = useCallback(async (command: string) => {
    const process = Bun.spawn(["bash", "-lc", command], {
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve("")
    const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve("")
    const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, process.exited])

    return { stdout, stderr, exitCode }
  }, [])

  const formatShellResult = useCallback((exitCode: number, stdout: string, stderr: string) => {
    const outputParts = [
      `exit_code: ${exitCode}`,
      stdout ? `stdout:
${truncate(stdout, MAX_SHELL_OUTPUT)}` : "stdout: <empty>",
      stderr ? `stderr:
${truncate(stderr, MAX_SHELL_OUTPUT)}` : "stderr: <empty>",
    ]
    return outputParts.join("\n")
  }, [])

  const runAgent = useCallback(
    async (history: UIMessage[], options?: { signal?: AbortSignal }) => {
      const sanitizedKey = apiKey.trim()
      if (!sanitizedKey) {
        throw new Error("OpenRouter API key is not set. Use the :key command to provide one.")
      }

      const selectModel = createModelSelector(sanitizedKey)
      const modelSettings = reasoningEffort
        ? { reasoning: { enabled: true, effort: reasoningEffort } }
        : undefined
      const result = await streamText({
        model: selectModel(modelId, modelSettings),
        messages: toCoreMessages(history),
        tools: agentTools,
        stopWhen: [], // allow multi-step runs so the model can respond after tool execution
        abortSignal: options?.signal,
      })

      if (!isMountedRef.current) {
        return
      }

      let assistantContent = ""
      let reasoningContent = ""
      const assistantId = randomUUID()
      let assistantMessageAdded = false
      const composeAssistantContent = (text: string) => {
        if (!thinkingEnabledRef.current) {
          return text
        }
        const trimmed = reasoningContent.trim()
        if (!trimmed) {
          return text
        }
        return `Reasoning:
${reasoningContent}

${text}`
      }

      try {
        const streamPromise = (async () => {
          const toolState = new Map<
            string,
            { messageId?: string; toolName: string; args: unknown; result?: unknown }
          >()

          const upsertToolMessage = (
            toolCallId: string,
            update: { toolName?: string; args?: unknown; result?: unknown },
          ) => {
            if (!isMountedRef.current) {
              return
            }

            const previous = toolState.get(toolCallId)
            const toolName = update.toolName ?? previous?.toolName ?? "unknown"
            const args = update.args ?? previous?.args ?? {}
            const result = update.result ?? previous?.result
            const payload: ToolEventPayload = {
              toolName,
              args,
              result,
              toolCallId,
            }

            const messageId = previous?.messageId ?? randomUUID()
            toolState.set(toolCallId, { messageId, toolName, args, result })

            setMessages((prev) => {
              const existingIndex = prev.findIndex(
                (message) => message.id === messageId || message.metadata?.toolCallId === toolCallId,
              )
              const previousMessage = existingIndex === -1 ? undefined : prev[existingIndex]
              const nextMessage: UIMessage = {
                id: messageId,
                role: "tool",
                content: formatToolEvent(payload),
                metadata: {
                  toolCallId,
                  toolName,
                  toolArgs: args,
                  toolResult: result,
                },
                timestamp: previousMessage?.timestamp ?? new Date(),
              }

              if (existingIndex === -1) {
                return [...prev, nextMessage]
              }

              return prev.map((message, index) => (index === existingIndex ? nextMessage : message))
            })
          }

          const renderToolResult = (
            toolCallId: string,
            details: { toolName?: string; args?: unknown; result: unknown },
          ) => {
            upsertToolMessage(toolCallId, details)
          }

          const stream = result.fullStream as AsyncIterable<any>

          for await (const part of stream) {
            if (!isMountedRef.current) {
              return
            }
            if (part.type === "text-end") {
              continue
            }

            if (part.type === "text-start") {
              continue
            }

            if (part.type === "text-end") {
              continue
            }

            if (part.type === "reasoning-start") {
              continue
            }

            if (part.type === "reasoning-end") {
              continue
            }

            if (part.type === "reasoning") {
              const chunk = typeof part.text === "string" ? part.text : ""
              if (chunk) {
                reasoningContent += chunk
              }
              continue
            }

            if (part.type === "reasoning-end") {
              continue
            }

            if (part.type === "text-delta") {
              const chunk =
                typeof part.textDelta === "string" ? part.textDelta : typeof part.delta === "string" ? part.delta : ""

              if (chunk) {
                assistantContent += chunk
                setMessages((prev) => {
                  const existingIndex = prev.findIndex((message) => message.id === assistantId)
                  const fullContent = composeAssistantContent(assistantContent)
                  if (existingIndex === -1) {
                    assistantMessageAdded = true
                    return [
                      ...prev,
                      { id: assistantId, role: "assistant", content: fullContent, timestamp: new Date() },
                    ]
                  }
                  return prev.map((message, index) =>
                    index === existingIndex ? { ...message, content: fullContent } : message,
                  )
                })
              }
              continue
            }

            if (part.type === "tool-call") {
              upsertToolMessage(part.toolCallId, {
                toolName: part.toolName ?? "unknown",
                args: part.input ?? {},
              })
              continue
            }

            if (part.type === "tool-result") {
              if (part.preliminary) {
                continue
              }

              renderToolResult(part.toolCallId, {
                toolName: part.toolName ?? undefined,
                args: part.input ?? undefined,
                result: part.output,
              })
              continue
            }

            if (part.type === "tool-error") {
              const errorMessage =
                part.error instanceof Error
                  ? part.error.message
                  : typeof part.error === "string"
                    ? part.error
                    : JSON.stringify(part.error, null, 2)

              renderToolResult(part.toolCallId, {
                toolName: part.toolName ?? undefined,
                args: part.input ?? undefined,
                result: `Error: ${errorMessage}`,
              })
              continue
            }

            if (part.type === "error") {
              const errorMessage =
                part.error instanceof Error
                  ? part.error.message
                  : typeof part.error === "string"
                    ? part.error
                    : JSON.stringify(part.error, null, 2)
              throw new Error(errorMessage)
            }
          }
        })()

        await streamPromise

        if (!isMountedRef.current) {
          return
        }

        let finalText = composeAssistantContent(assistantContent)
        if (!assistantMessageAdded || !assistantContent.trim()) {
          try {
            const resolvedText = await result.text
            if (typeof resolvedText === "string") {
              finalText = composeAssistantContent(resolvedText)
            }
          } catch (finalTextError) {
            console.warn("Failed to load final assistant text", finalTextError)
          }
        }

        const trimmedFinalText = finalText.trim()

        if (assistantMessageAdded) {
          if (!trimmedFinalText) {
            setMessages((prev) => prev.filter((message) => message.id !== assistantId))
          } else if (finalText !== composeAssistantContent(assistantContent)) {
            const nextContent = finalText
            setMessages((prev) =>
              prev.map((message) => (message.id === assistantId ? { ...message, content: nextContent } : message)),
            )
          }
        } else if (trimmedFinalText) {
          assistantMessageAdded = true
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content: finalText, timestamp: new Date() },
          ])
        }

        if (trimmedFinalText) {
          try {
            await appendSessionEntry({
              id: assistantId,
              role: "assistant",
              content: finalText,
              timestamp: new Date().toISOString(),
            })
          } catch (historyError) {
            console.warn("Failed to persist assistant history entry", historyError)
          }
        }
      } catch (streamError) {
        if (isMountedRef.current && assistantMessageAdded) {
          setMessages((prev) => prev.filter((message) => message.id !== assistantId))
        }
        throw streamError
      }
    },
    [apiKey, modelId, reasoningEffort],
  )

  const handleCommand = useCallback((command: string) => {
    const [keyword, ...rest] = command.slice(1).split(" ")
    const argument = rest.join(" ").trim()

    if (keyword === "model") {
      if (!argument) {
        setError("Usage: :model <model-id>")
        return
      }
      setModelId(argument)
      setReasoningEffort(null)
      setError(null)
      setMessages((prev) => [
        ...prev,
        {
          id: randomUUID(),
          role: "system",
          content: `Model set to ${argument}`,
          timestamp: new Date(),
        },
      ])
      return
    }

    if (keyword === "key") {
      if (!argument) {
        setError("Usage: :key <OPENROUTER_API_KEY>")
        return
      }
      setApiKey(argument)
      setError(null)
      setMessages((prev) => [
        ...prev,
        {
          id: randomUUID(),
          role: "system",
          content: `Updated OpenRouter API key (${argument.length} characters provided).`,
          timestamp: new Date(),
        },
      ])
      return
    }

    if (keyword === "reset") {
      setMessages([initialSystemMessage])
      setError(null)
      return
    }

    setError(`Unknown command: ${keyword}`)
  }, [])

  const performSubmit = useCallback(
    async (value: string, { signal }: { signal: AbortSignal }) => {
      const trimmed = value.trim()
      if (!trimmed) {
        return
      }

      setInputValue("")

      if (trimmed.startsWith(":")) {
        handleCommand(trimmed)
        return
      }

      const sanitizedKey = apiKey.trim()
      if (status === "running") {
        setError("Assistant is still responding. Please wait.")
        return
      }

      if (!sanitizedKey) {
        setError("Set an OpenRouter API key before chatting (:key <token>). ")
        return
      }

      if (trimmed.startsWith("!")) {
        const commandText = trimmed.slice(1).trim()
        if (!commandText) {
          setError("Usage: !<command>")
          return
        }

        setError(null)
        const userMessage: UIMessage = {
          id: randomUUID(),
          role: "user",
          content: trimmed,
          timestamp: new Date(),
        }

        const historyMessages = [...messages, userMessage]
        setMessages(historyMessages)
        setStatus("running")

        try {
          const result = await runShellCommand(commandText)
          const assistantMessage: UIMessage = {
            id: randomUUID(),
            role: "assistant",
            content: formatShellResult(result.exitCode ?? 0, result.stdout, result.stderr),
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, assistantMessage])
        } catch (shellError) {
          if (isMountedRef.current) {
            setMessages((prev) => [
              ...prev,
              {
                id: randomUUID(),
                role: "assistant",
                content: `Shell command failed: ${(shellError as Error).message}`,
                timestamp: new Date(),
              },
            ])
          }
          setError((shellError as Error).message)
        } finally {
          if (isMountedRef.current) {
            setStatus("idle")
          }
        }

        return
      }

      if (trimmed.startsWith("#")) {
        const memoryText = trimmed.slice(1).trim()
        if (!memoryText) {
          setError("Usage: # <memory entry>")
          return
        }

        try {
          await appendMemoryEntry(memoryText)
          const userMessage: UIMessage = {
            id: randomUUID(),
            role: "user",
            content: trimmed,
            timestamp: new Date(),
          }
          const confirmationMessage: UIMessage = {
            id: randomUUID(),
            role: "system",
            content: `Saved to memory: ${memoryText}`,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, userMessage, confirmationMessage])
          setError(null)
        } catch (memoryError) {
          setError((memoryError as Error).message)
        }

        return
      }

      if (trimmed.startsWith("/")) {
        const commandInput = trimmed.slice(1).trim()
        if (!commandInput) {
          setError("Usage: /<command-name> [arguments]")
          return
        }

        const firstSpace = commandInput.indexOf(" ")
        const commandName = firstSpace === -1 ? commandInput : commandInput.slice(0, firstSpace)
        const argumentText = firstSpace === -1 ? "" : commandInput.slice(firstSpace + 1).trim()

        if (commandName === "model") {
          setError(null)
          openModelPicker(argumentText)
          if (argumentText && modelPickerState.fetchState === "success") {
            handleFilterSubmit(argumentText)
          }
          return
        }

        if (commandName === "clear") {
          if (argumentText) {
            setError("Usage: /clear")
            return
          }

          setMessages([initialSystemMessage])
          setStatus("idle")
          setError(null)
          return
        }

        try {
          setError(null)
          const execution = await executeSlashCommand(commandName, argumentText)
          const userMessage: UIMessage = {
            id: randomUUID(),
            role: "user",
            content: formatSlashCommandMessage(execution),
            timestamp: new Date(),
          }

          const historyMessages = [...messages, userMessage]
          setMessages(historyMessages)
          setStatus("running")

          try {
            await runAgent(historyMessages, { signal })
          } catch (agentError) {
            if (signal.aborted) {
              setError("Generation cancelled.")
            } else if (isMountedRef.current) {
              setMessages((prev) => [
                ...prev,
                {
                  id: randomUUID(),
                  role: "assistant",
                  content: `Encountered an error: ${(agentError as Error).message}`,
                  timestamp: new Date(),
                },
              ])
              setError((agentError as Error).message)
            }
          } finally {
            if (isMountedRef.current) {
              setStatus("idle")
            }
          }
        } catch (commandError) {
          setError((commandError as Error).message)
        }

        return
      }

      setError(null)
      const userMessage: UIMessage = {
        id: randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      }

      const historyMessages = [...messages, userMessage]
      setMessages(historyMessages)
      setStatus("running")

      try {
        await runAgent(historyMessages, { signal })
      } catch (agentError) {
        if (signal.aborted) {
          setError("Generation cancelled.")
        } else if (isMountedRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: randomUUID(),
              role: "assistant",
              content: `Encountered an error: ${(agentError as Error).message}`,
              timestamp: new Date(),
            },
          ])
          setError((agentError as Error).message)
        }
      } finally {
        if (isMountedRef.current) {
          setStatus("idle")
        }
      }
    },
    [
      apiKey,
      formatShellResult,
      handleCommand,
      handleFilterSubmit,
      messages,
      modelPickerState.fetchState,
      openModelPicker,
      runAgent,
      runShellCommand,
      status,
    ],
  )

  const handleBackgroundRequest = useCallback(
    (rawCommand: string) => {
      const trimmed = rawCommand.trim()
      if (!trimmed.startsWith("!")) {
        setError("Background mode requires a !command input.")
        return false
      }

      const commandText = trimmed.slice(1).trim()
      if (!commandText) {
        setError("Usage: !<command>")
        return false
      }

      const taskId = randomUUID()
      const startedAt = new Date()

      setBackgroundTasks((prev) => [
        ...prev,
        {
          id: taskId,
          command: commandText,
          status: "running",
          exitCode: null,
          stdout: "",
          stderr: "",
          startedAt,
        },
      ])

      if (isMountedRef.current) {
        setMessages((prev) => [
          ...prev,
          {
            id: randomUUID(),
            role: "system",
            content: `Started background task ${taskId} (${commandText}).`,
            timestamp: startedAt,
          },
        ])
      }

      ;(async () => {
        try {
          const result = await runShellCommand(commandText)
          const finishedAt = new Date()
          setBackgroundTasks((prev) =>
            prev.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: result.exitCode === 0 ? "succeeded" : "failed",
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    finishedAt,
                  }
                : task,
            ),
          )

          if (isMountedRef.current) {
            const summary = result.exitCode === 0 ? "completed" : `exited with code ${result.exitCode}`
            setMessages((prev) => [
              ...prev,
              {
                id: randomUUID(),
                role: "system",
                content: `Background task ${taskId} ${summary}.`,
                timestamp: finishedAt,
              },
              {
                id: randomUUID(),
                role: "assistant",
                content: formatShellResult(result.exitCode ?? 0, result.stdout, result.stderr),
                timestamp: finishedAt,
              },
            ])
          }
        } catch (error) {
          const finishedAt = new Date()
          setBackgroundTasks((prev) =>
            prev.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: "failed",
                    stderr: (error as Error).message,
                    finishedAt,
                  }
                : task,
            ),
          )

          if (isMountedRef.current) {
            setMessages((prev) => [
              ...prev,
              {
                id: randomUUID(),
                role: "system",
                content: `Background task ${taskId} failed: ${(error as Error).message}`,
                timestamp: finishedAt,
              },
            ])
          }
        }
      })()

      setError(null)
      return true
    },
    [formatShellResult, runShellCommand, setBackgroundTasks, setMessages, setError],
  )

  const interactive = useInteractiveController({
    inputValue,
    setInputValue,
    messages,
    setMessages,
    isRunning: status === "running",
    performSubmit,
    onAbort: () => {
      if (!isMountedRef.current) {
        return
      }
      if (status === "running") {
        setStatus("idle")
        setError("Generation cancelled.")
      }
    },
    onRewind: () => {
      if (!isMountedRef.current) {
        return
      }
      setStatus("idle")
      setError(null)
    },
    onBackgroundRequest: handleBackgroundRequest,
  })

  const { thinkingEnabled, permissionMode, historySearch } = interactive
  useEffect(() => {
    thinkingEnabledRef.current = thinkingEnabled
  }, [thinkingEnabled])

  const modelDisplay = reasoningEffort ? `${modelId} (effort: ${reasoningEffort})` : modelId
  const statusDisplay = status === "running" && statusElapsed ? `running - ${statusElapsed}` : status



  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1} style={{ backgroundColor: theme.background }}>
      {messages.length >= 1 && (
        <box
          flexDirection="column"
          gap={1}
          style={{ border: ["left"], padding: 1, backgroundColor: theme.header, borderColor: theme.headerBorder }}
        >
        <box justifyContent="space-between" flexDirection="row">
          <ascii-font font="tiny" text="Gambit" />
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
              Model · {modelDisplay}
          </text>
        </box>
        {/* <box flexDirection="column">
          <text fg={theme.statusFg} attributes={status === "running" ? TextAttributes.BLINK : TextAttributes.DIM}>
            Status · {status === "running" ? "thinking€¦" : "idle"}
          </text>
        </box> */}
        {/* <box>
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
              Model · {modelDisplay}
          </text>
        </box> */}
        {/* <box justifyContent="space-between" alignItems="flex-start">
          <box flexDirection="column" gap={1}>
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
              Model · {modelDisplay}
            </text>
          </box>
          <text fg={apiKey ? theme.statusFg : theme.headerAccent}>API key · {apiKey ? "configured" : "missing"}</text>
        </box> */}
      </box>)}

      {error ? (
        <box style={{ border: ["left"], padding: 1, backgroundColor: theme.systemBg }}>
          <text fg="#ff6b6b" content={`Error: ${error}`} />
        </box>
      ) : null}

      <scrollbox
        ref={scrollboxRef}
        scrollY
        stickyScroll
        stickyStart="bottom"
        style={{
          rootOptions: {
            // border: ["left"],
            flexGrow: 1,
            backgroundColor: theme.background,
            borderColor: theme.bodyBorder,
          },
          contentOptions: { flexDirection: "column", gap: 1, padding: 1, backgroundColor: theme.background },
        }}
      >
        {messages
          .filter((message) => !message.hidden)
          .map((message) => {
            const presentation = rolePresentation[message.role] ?? rolePresentation.system
            const labelSuffix =
              message.role === "tool" && message.metadata?.toolName ? ` · ${message.metadata.toolName}` : ""
            return (
              <box
                key={message.id}
                flexDirection="column"
                gap={0}
                style={{
                  border: ["left"],
                  borderStyle: "heavy",
                  padding: 1,
                  backgroundColor: presentation.backgroundColor,
                  borderColor: theme.bodyBorder,
                }}
              >
                <text
                  fg={theme.headerAccent}
                  attributes={TextAttributes.BOLD}
                  content={`${presentation.label}${labelSuffix}`}
                />
                <Markdown content={message.content} textColor={presentation.textColor} />
                <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                  {timestampLabels[message.role]} · {formatTimestamp(message.timestamp)}
                </text>
              </box>
            )
          })}
      </scrollbox>

      {historySearch.active ? (
        <box
          style={{
            border: ["left"],
            borderColor: theme.headerBorder,
            backgroundColor: theme.header,
            padding: 1,
          }}
        >
          <text
            fg={theme.headerAccent}
            attributes={TextAttributes.BOLD}
            content={`reverse-search: ${historySearch.query || '...'}${historySearch.match ? ` -> ${historySearch.match}` : ''}`}
          />
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Esc to cancel, Ctrl+R to search older matches" />
        </box>
      ) : null}

      <box
        flexDirection="row"
        gap={3}
        style={{ border: ["left"], borderColor: theme.bodyBorder, padding: 1, backgroundColor: theme.background }}
      >
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`Thinking - ${thinkingEnabled ? 'on' : 'off'}`} />
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`Permissions - ${permissionMode}`} />
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`Status - ${statusDisplay}`} />
      </box>

      {backgroundTasks.length > 0 ? (
        <box
          flexDirection="column"
          style={{ border: ["left"], borderColor: theme.bodyBorder, padding: 1, backgroundColor: theme.background }}
        >
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Background tasks" />
          {backgroundTasks.slice(-5).map((task) => (
            <text
              key={task.id}
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`${task.id.slice(0, 8)} [${task.status}${task.exitCode !== null ? `:${task.exitCode}` : ''}] ${task.command}`}
            />
          ))}
        </box>
      ) : null}

      {modelPickerState.isOpen ? (
        <ModelPickerOverlay
          state={modelPickerState}
          currentModelId={modelId}
          onFilterChange={handleModelFilterChange}
          onFilterSubmit={handleFilterSubmit}
          onReasoningChange={handleReasoningInput}
          onReasoningSubmit={handleReasoningSubmit}
          onOptionChange={(index) => setModelSelection(index)}
          onOptionSelect={(index) => selectModelByIndex(index)}
        />
      ) : (
        <box
          flexDirection="column"
          gap={0}
          style={{
            border: ["left"],
            borderStyle: "heavy",
            borderColor: theme.inputBorder,
            paddingTop: 1,
            paddingBottom: 2,
            paddingLeft: 2,
            backgroundColor: theme.header,
          }}
        >
          <input
            value={inputValue}
            onInput={interactive.handleInput}
            onSubmit={interactive.handleSubmit}
            focused
            style={{
              // backgroundColor: theme.inputBg,
              // focusedBackgroundColor: theme.inputFocusedBg,
            }}
          />
        </box>
      )}
    </box>
  )
}
