import path from "node:path";

export const workspaceRoot = path.resolve(Bun.env.WORKSPACE_ROOT ?? process.cwd());
export const defaultModel = Bun.env.OPENROUTER_MODEL ?? "z-ai/glm-4.6";
export const refererHeader = Bun.env.OPENROUTER_REFERRER ?? "https://github.com/opentui/gambit";
export const titleHeader = Bun.env.OPENROUTER_TITLE ?? "Gambit TUI Agent";
export const freeModelPresets = ["z-ai/glm-4.6"] as const;

export const MAX_FILE_CHARS = 60_000;
export const MAX_SHELL_OUTPUT = 20_000;
