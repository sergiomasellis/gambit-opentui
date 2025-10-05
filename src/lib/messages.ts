import type { UIMessage } from "../types/chat";
import type { ToolEventPayload } from "../types/tools";

export function toCoreMessages(messages: UIMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.metadata?.toolCallId ?? message.id,
      };
    }
    return { role: message.role, content: message.content };
  }) as any;
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
