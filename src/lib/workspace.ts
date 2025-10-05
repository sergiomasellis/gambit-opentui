import path from "node:path";
import { workspaceRoot } from "../config";

export function resolveWorkspacePath(targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error("Access denied: path escapes workspace root.");
  }
  return resolved;
}

export function relativeWorkspacePath(absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative === "" ? "." : relative;
}
