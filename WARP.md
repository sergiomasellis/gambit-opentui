# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project summary
- Stack: Bun + TypeScript + React (OpenTUI)
- Entry: src/index.tsx renders <App /> via @opentui/react
- Tests: Bun’s built-in test runner; tests co-located as *.test.ts
- Docs to surface: README.md (install/run), AGENTS.md (repo overview), system.prompt.md (agent/system prompt appended with project docs)

Commands
- Install dependencies
```sh path=null start=null
bun install
```
- Run the TUI app
```sh path=null start=null
bun run src/index.tsx
```
- Run all tests
```sh path=null start=null
bun test
```
- Run a single test file (example)
```sh path=null start=null
bun test src/lib/slashCommands.test.ts
```
Notes
- No linter is configured in this repo. TypeScript is set to strict in tsconfig.json. If you need a one-off type check, you can run tsc without emitting files:
```sh path=null start=null
bun x tsc --noEmit
```
(Typescript is declared as a peerDependency; bun x will install it transiently if missing.)

High-level architecture
- Rendering and UI (OpenTUI)
  - src/index.tsx boots the app using @opentui/react’s render().
  - src/App.tsx composes the terminal UI: header/status, scrollable message list, and input box. Messages are rendered as Markdown via src/ui/Markdown.tsx using marked with terminal-friendly styling (src/ui/theme.ts).
- Conversation engine
  - src/App.tsx streams model responses with ai.streamText. It converts UI messages to the SDK’s format via src/lib/messages.ts and wires in tools (agentTools from src/tools/index.ts).
  - Reasoning segments (if enabled) are prefixed into the visible assistant content. Tool calls and tool results are rendered as synthetic “tool” messages formatted by formatToolEvent().
  - The system prompt is built by src/lib/prompt.ts: defaults + optional system.prompt.md + concatenated project docs discovered by src/lib/projectDocs.ts.
- Tools (agent execution surface)
  - src/tools/index.ts declares tools exposed to the model:
    - readFile, writeFile: bounded to the workspace root (see src/lib/workspace.ts).
    - patchFile: applies unified diff patches (per-file splitting, create/update/delete/rename) using src/lib/diff.ts.
    - executeShell: spawns commands via Bun.spawn(["bash","-lc", …]) in the workspace root.
    - slashCommand: loads and executes user-defined commands (see below).
  - Workspace safety: all file paths are resolved relative to workspaceRoot (env WORKSPACE_ROOT or process.cwd()) and validated to prevent path traversal.
- Slash commands (project/user commands)
  - src/lib/slashCommands.ts discovers markdown command files under:
    - project: .gambit/commands within the workspace
    - user: ~/.gambit/commands
  - Filenames become commands; nested folders create namespaces (e.g., frontend/review).
  - Frontmatter keys supported: description, argument-hint, allowed-tools, model, disable-model-invocation.
  - Command bodies can embed shell executions:
    - Inline: !`echo hi`
    - Line-prefixed: lines starting with ! run via bash -lc
  - When project and user define the same base name, the project’s command wins. If multiple namespaces share a name, users must disambiguate.
- Interactive layer (input, history, modes)
  - src/lib/interactive/controller.tsx coordinates input, submit, keyboard handling, and UI state for history search, “thinking” toggle, and permission modes.
  - src/lib/interactive/history.ts persists reverse-searchable input history in .gambit/history.json.
  - src/lib/interactive/session.ts tracks snapshots (for quick rollback), AbortController for cancelling runs, and toggles:
    - PermissionMode: normal → plan → auto-accept (cycled)
    - Thinking on/off
  - Keyboard shortcuts are mapped in src/lib/interactive/shortcuts.ts (e.g., Ctrl+C abort run, Ctrl+R reverse search, Shift+Tab permission cycle, Ctrl+Enter newline).
- Configuration and environment
  - src/config.ts centralizes:
    - workspaceRoot (from WORKSPACE_ROOT)
    - defaultModel (OPENROUTER_MODEL, default z-ai/glm-4.6)
    - OpenRouter headers (OPENROUTER_REFERRER, OPENROUTER_TITLE)
    - Size budgets (MAX_FILE_CHARS, MAX_SHELL_OUTPUT, PROJECT_DOC_MAX_BYTES, SLASH_COMMAND_TOOL_CHAR_BUDGET)

Important files to reference
- README.md: shows the canonical install and run commands for this Bun project.
- AGENTS.md: concise repository guidelines and structure overview useful for onboarding.
- system.prompt.md: baseline system prompt merged with discovered project docs; it influences agent behavior.
- .gambit/commands: project-scoped slash commands (if present). Users can also define personal commands under ~/.gambit/commands.

Environment variables
- OPENROUTER_API_KEY: required to chat with the model. The UI provides a ":key <token>" command to set it at runtime if not set in the environment.
- OPENROUTER_MODEL: overrides the default model id used by the app.
- WORKSPACE_ROOT: sets the root directory for file/tool operations and history.
- OPENROUTER_REFERRER, OPENROUTER_TITLE: identify the app to OpenRouter.

Platform note
- Shell execution for slash commands and executeShell uses bash -lc; ensure an appropriate bash is available in your environment for those features to work on Windows.
