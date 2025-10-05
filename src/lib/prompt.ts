import { PROJECT_DOC_SEPARATOR, readProjectDocs } from "./projectDocs";
import { resolveWorkspacePath } from "./workspace";

const defaultSystemPrompt = [
  "You are Gambit, a meticulous AI coding agent collaborating inside a Bun-powered terminal UI.",
  "Apply changes safely, prefer concise explanations, and use the available tools (`readFile`, `writeFile`, `patchFile`, `executeShell`) to gather context or modify the workspace.",
  "Always confirm significant actions and avoid speculative answers when tool usage is more reliable.",
].join(" ");

export async function loadSystemPrompt(): Promise<string> {
  let prompt = defaultSystemPrompt;

  try {
    const promptPath = resolveWorkspacePath("system.prompt.md");
    const promptFile = Bun.file(promptPath);
    if (await promptFile.exists()) {
      const content = (await promptFile.text()).trim();
      if (content.length > 0) {
        prompt = content;
      }
    }
  } catch {
    // Ignore and fall back to the default prompt
  }

  try {
    const projectDocs = await readProjectDocs();
    if (projectDocs) {
      prompt = prompt ? `${prompt}${PROJECT_DOC_SEPARATOR}${projectDocs}` : projectDocs;
    }
  } catch (error) {
    console.error("Failed to load project docs:", error);
  }

  return prompt;
}
