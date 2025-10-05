export interface ToolEventPayload {
  toolName?: string;
  name?: string;
  toolCallId?: string;
  id?: string;
  args?: unknown;
  arguments?: unknown;
  result?: unknown;
  output?: unknown;
}
