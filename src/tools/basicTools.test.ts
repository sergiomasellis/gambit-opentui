import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { setWorkspaceRootForTesting, workspaceRoot } from "../config";
import { agentTools } from "./index";

let workspaceDir: string;
let originalWorkspaceRootEnv: string | undefined;
let originalWorkspaceRootValue: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-tools-"));
  originalWorkspaceRootEnv = process.env.WORKSPACE_ROOT;
  originalWorkspaceRootValue = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceDir;
  setWorkspaceRootForTesting(workspaceDir);
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  if (originalWorkspaceRootEnv === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = originalWorkspaceRootEnv;
  }
  setWorkspaceRootForTesting(originalWorkspaceRootValue);
});

test("readFile rejects missing path", async () => {
  await expect(agentTools.readFile.execute({} as any)).rejects.toThrow(
    'Parameter "path" must be a string.',
  );
});

test("writeFile rejects non-string content", async () => {
  await expect(
    agentTools.writeFile.execute({ path: "file.txt", content: undefined as any }),
  ).rejects.toThrow('Parameter "content" must be a string.');
});

test("executeShell rejects non-string command", async () => {
  await expect(agentTools.executeShell.execute({ command: undefined as any })).rejects.toThrow(
    'Parameter "command" must be a string.',
  );
});
