import type { ToolResultPart, ModelMessage } from "@ai-sdk/provider-utils";

import type { UIMessage } from "../types/chat";
import type { ToolEventPayload } from "../types/tools";

const toToolResultOutput = (value: unknown): ToolResultPart["output"] => {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    "value" in value &&
    typeof (value as { type?: unknown }).type === "string"
  ) {
    const { type, value: rawValue } = value as { type: string; value: unknown };
    if (type === "text" || type === "error-text") {
      if (typeof rawValue === "string") {
        return { type, value: rawValue };
      }
    } else if (type === "json" || type === "error-json") {
      return { type, value: rawValue ?? null };
    } else if (type === "content" && Array.isArray(rawValue)) {
      return { type, value: rawValue as ToolResultPart["output"]["value"] };
    }
  }

  if (typeof value === "string") {
    return { type: "text", value };
  }

  return { type: "json", value: value ?? null };
};

export function toCoreMessages(messages: UIMessage[]): ModelMessage[] {
  return messages.map<ModelMessage>((message) => {
    if (message.role === "tool") {
      const toolCallId = message.metadata?.toolCallId ?? message.id;
      const toolName = message.metadata?.toolName ?? "tool";
      const toolSource = message.metadata?.toolResult ?? message.content;
      const toolContent: ToolResultPart = {
        type: "tool-result",
        toolCallId,
        toolName,
        output: toToolResultOutput(toolSource),
      };
      return { role: "tool", content: [toolContent] };
    }

    return { role: message.role, content: message.content };
  });
}

export function formatToolEvent(event: ToolEventPayload): string {
  const toolName = String(event.toolName ?? event.name ?? "tool");
  const args = event.args ?? event.arguments ?? {};
  const result = event.result ?? event.output;

  const formattedArgs = JSON.stringify(args, null, 2);
  const formattedResult =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return [
    `[tool:${toolName}]`,
    `arguments: ${formattedArgs}`,
    result !== undefined ? `result: ${formattedResult}` : "result: <pending>",
  ].join("\n");
}
