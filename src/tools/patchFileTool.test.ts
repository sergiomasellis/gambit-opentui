import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let workspaceDir: string;
let patchTool: (params: { path?: string; patch: string }) => Promise<string>;
let originalWorkspaceRoot: string | undefined;

beforeAll(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-patch-tool-"));
  originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  process.env.WORKSPACE_ROOT = workspaceDir;
  const toolsModule = await import("./index");
  patchTool = async (params) => toolsModule.agentTools.patchFile.execute(params as any);
});

afterAll(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  if (originalWorkspaceRoot === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
  }
});

test("patch tool deletes files when diff targets /dev/null", async () => {
  const relativePath = "example.txt";
  const absolutePath = path.join(workspaceDir, relativePath);
  await writeFile(absolutePath, "line one\nline two\n");

  const deletionDiff = `diff --git a/${relativePath} b/${relativePath}\n` +
    `--- a/${relativePath}\n` +
    "+++ /dev/null\n" +
    "@@ -1,2 +0,0 @@\n" +
    "-line one\n" +
    "-line two\n";

  const result = await patchTool({ path: relativePath, patch: deletionDiff });

  expect(result).toContain(`Deleted ${relativePath} via patch.`);
  expect(await Bun.file(absolutePath).exists()).toBe(false);
});

test("patch tool applies multi-file diff for create and update", async () => {
  const updatePath = "existing.txt";
  const newPath = "new-file.txt";
  await writeFile(path.join(workspaceDir, updatePath), "old line\n");

  const multiDiff = `diff --git a/${updatePath} b/${updatePath}\n` +
    `--- a/${updatePath}\n` +
    `+++ b/${updatePath}\n` +
    "@@ -1 +1 @@\n" +
    "-old line\n" +
    "+new line\n" +
    `diff --git a/${newPath} b/${newPath}\n` +
    "new file mode 100644\n" +
    "--- /dev/null\n" +
    `+++ b/${newPath}\n` +
    "@@ -0,0 +1 @@\n" +
    "+hello world\n";

  const result = await patchTool({ patch: multiDiff });

  expect(result.split("\n")).toEqual(
    expect.arrayContaining([
      `Updated ${updatePath} via patch.`,
      `Created ${newPath} via patch.`,
    ]),
  );

  expect(await Bun.file(path.join(workspaceDir, updatePath)).text()).toBe("new line\n");
  expect(await Bun.file(path.join(workspaceDir, newPath)).text()).toBe("hello world\n");
});

test("patch tool handles rename within diff", async () => {
  const oldRelative = "old-name.txt";
  const newRelative = "renamed/name.txt";
  await writeFile(path.join(workspaceDir, oldRelative), "alpha\nbeta\n");

  const renameDiff = `diff --git a/${oldRelative} b/${newRelative}\n` +
    `similarity index 100%\n` +
    `rename from ${oldRelative}\n` +
    `rename to ${newRelative}\n` +
    `--- a/${oldRelative}\n` +
    `+++ b/${newRelative}\n` +
    "@@ -1,2 +1,2 @@\n" +
    "-alpha\n" +
    "+alpha-renamed\n" +
    " beta\n";

  const result = await patchTool({ patch: renameDiff });

  expect(result).toContain(`Moved ${oldRelative} -> ${newRelative} via patch.`);
  expect(await Bun.file(path.join(workspaceDir, oldRelative)).exists()).toBe(false);
  expect(await Bun.file(path.join(workspaceDir, newRelative)).text()).toBe("alpha-renamed\nbeta\n");
});
