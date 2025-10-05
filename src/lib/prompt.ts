import { resolveWorkspacePath } from "./workspace";

const defaultSystemPrompt = [
  "You are Codex, a meticulous AI coding agent collaborating inside a Bun-powered terminal UI.",
  "Apply changes safely, prefer concise explanations, and use the available tools (`readFile`, `writeFile`, `patchFile`, `executeShell`) to gather context or modify the workspace.",
  "Always confirm significant actions and avoid speculative answers when tool usage is more reliable.",
].join(" ");

export async function loadSystemPrompt(): Promise<string> {
  try {
    const promptPath = resolveWorkspacePath("system.prompt.md");
    const promptFile = Bun.file(promptPath);
    if (await promptFile.exists()) {
      const content = (await promptFile.text()).trim();
      if (content.length > 0) {
        return content;
      }
    }
  } catch {
    // Ignore and fall back to the default prompt
  }
  return defaultSystemPrompt;
}
