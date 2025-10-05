import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { streamText } from "ai"
import { randomUUID } from "node:crypto"
import { useCallback, useEffect, useRef, useState } from "react"

import { defaultModel } from "./config"
import { formatToolEvent, toCoreMessages } from "./lib/messages"
import { createModelSelector } from "./lib/model"
import { loadSystemPrompt } from "./lib/prompt"
import { theme, rolePresentation } from "./ui/theme"
import { Markdown } from "./ui/Markdown"
import type { UIMessage } from "./types/chat"
import type { ToolEventPayload } from "./types/tools"
import { agentTools } from "./tools"

const systemPrompt = await loadSystemPrompt()

const initialSystemMessage: UIMessage = {
  id: randomUUID(),
  role: "system",
  content: systemPrompt,
  hidden: true,
  timestamp: new Date(),
}

export function App() {
  const [messages, setMessages] = useState<UIMessage[]>([initialSystemMessage])
  const [inputValue, setInputValue] = useState("")
  const [modelId, setModelId] = useState(defaultModel)
  const [apiKey, setApiKey] = useState<string>(Bun.env.OPENROUTER_API_KEY ?? "")
  const [status, setStatus] = useState<"idle" | "running">("idle")
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)

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

  const runAgent = useCallback(
    async (history: UIMessage[]) => {
      if (!apiKey) {
        throw new Error("OpenRouter API key is not set. Use the :key command to provide one.")
      }

      const selectModel = createModelSelector(apiKey)
      const result = await streamText({
        model: selectModel(modelId),
        messages: toCoreMessages(history),
        tools: agentTools,
        stopWhen: [], // allow multi-step runs so the model can respond after tool execution
      })

      if (!isMountedRef.current) {
        return
      }

      let assistantContent = ""
      let reasoningContent = ""
      const assistantId = randomUUID()
      let assistantMessageAdded = false

      try {
        const streamPromise = (async () => {
          const toolState = new Map<string, { messageId?: string; toolName: string; args: unknown }>()

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
            const payload: ToolEventPayload = {
              toolName,
              args,
              result: update.result,
              toolCallId,
            }

            const messageId = previous?.messageId ?? randomUUID()
            toolState.set(toolCallId, { messageId, toolName, args })

            setMessages((prev) => {
              const existingIndex = prev.findIndex(
                (message) => message.id === messageId || message.metadata?.toolCallId === toolCallId,
              )
              const nextMessage: UIMessage = {
                id: messageId,
                role: "tool",
                content: formatToolEvent(payload),
                metadata: {
                  toolCallId,
                  toolName,
                },
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
            console.log("Received part:", part)

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
                  const fullContent = reasoningContent
                    ? `Reasoning:\n${reasoningContent}\n\n${assistantContent}`
                    : assistantContent
                  if (existingIndex === -1) {
                    assistantMessageAdded = true
                    return [...prev, { id: assistantId, role: "assistant", content: fullContent }]
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

        let finalText = reasoningContent ? `Reasoning:\n${reasoningContent}\n\n${assistantContent}` : assistantContent
        if (!assistantMessageAdded || !assistantContent.trim()) {
          try {
            const resolvedText = await result.text
            if (typeof resolvedText === "string") {
              finalText = reasoningContent ? `Reasoning:\n${reasoningContent}\n\n${resolvedText}` : resolvedText
            }
          } catch (finalTextError) {
            console.warn("Failed to load final assistant text", finalTextError)
          }
        }

        if (assistantMessageAdded) {
          if (!finalText.trim()) {
            setMessages((prev) => prev.filter((message) => message.id !== assistantId))
          } else if (finalText !== assistantContent) {
            const nextContent = finalText
            setMessages((prev) =>
              prev.map((message) => (message.id === assistantId ? { ...message, content: nextContent } : message)),
            )
          }
        } else if (finalText.trim()) {
          assistantMessageAdded = true
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: finalText }])
        }
      } catch (streamError) {
        if (isMountedRef.current && assistantMessageAdded) {
          setMessages((prev) => prev.filter((message) => message.id !== assistantId))
        }
        throw streamError
      }
    },
    [apiKey, modelId],
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
      setError(null)
      setMessages((prev) => [
        ...prev,
        {
          id: randomUUID(),
          role: "system",
          content: `Model set to ${argument}`,
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

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) {
        return
      }

      setInputValue("")

      if (trimmed.startsWith(":")) {
        handleCommand(trimmed)
        return
      }

      if (status === "running") {
        setError("Assistant is still responding. Please wait.")
        return
      }

      if (!apiKey) {
        setError("Set an OpenRouter API key before chatting (:key <token>). ")
        return
      }

      setError(null)
      const userMessage: UIMessage = {
        id: randomUUID(),
        role: "user",
        content: trimmed,
      }

      const history = [...messages, userMessage]
      setMessages(history)
      setStatus("running")

      try {
        await runAgent(history)
      } catch (agentError) {
        if (isMountedRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: randomUUID(),
              role: "assistant",
              content: `Encountered an error: ${(agentError as Error).message}`,
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
    [apiKey, handleCommand, messages, runAgent, status],
  )

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1} style={{ backgroundColor: theme.background }}>
      <box
        flexDirection="column"
        gap={1}
        style={{ border: ["left"], padding: 1, backgroundColor: theme.header }}
      >
        <box justifyContent="space-between" alignItems="flex-start">
          <ascii-font font="tiny" text="Gambit" />
        </box>
        <box flexDirection="column">
          <text fg={theme.statusFg} attributes={status === "running" ? TextAttributes.BLINK : TextAttributes.DIM}>
            Status · {status === "running" ? "thinking…" : "idle"}
          </text>
        </box>
        <box>
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
              Model · {modelId}
          </text>
        </box>
        {/* <box justifyContent="space-between" alignItems="flex-start">
          <box flexDirection="column" gap={1}>
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
              Model · {modelId}
            </text>
          </box>
          <text fg={apiKey ? theme.statusFg : theme.headerAccent}>API key · {apiKey ? "configured" : "missing"}</text>
        </box> */}
      </box>

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
            border: ["left"],
            flexGrow: 1,
            backgroundColor: theme.panel,
          },
          contentOptions: { flexDirection: "column", gap: 1, padding: 1, backgroundColor: theme.panel },
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
                }}
              >
                <text
                  fg={theme.headerAccent}
                  attributes={TextAttributes.BOLD}
                  content={`${presentation.label}${labelSuffix}`}
                />
                <Markdown content={message.content} textColor={presentation.textColor} />
              </box>
            )
          })}
      </scrollbox>

      <box
        flexDirection="column"
        gap={0}
        style={{
          border: ["left"],
          borderStyle: "heavy",
          borderColor: "#3f3f3f",
          paddingTop: 1,
          paddingBottom: 2,
          paddingLeft: 2,
          backgroundColor: theme.header,
        }}
      >
        <input
          value={inputValue}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          focused
          style={{
            backgroundColor: theme.inputBg,
            focusedBackgroundColor: theme.inputFocusedBg,
          }}
        />
      </box>
    </box>
  )
}
