import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  projectDocFallbackFilenames,
  projectDocMaxBytes,
  workspaceRoot,
} from "../config";

export const DEFAULT_PROJECT_DOC_FILENAME = "AGENTS.md";
export const PROJECT_DOC_SEPARATOR = "\n\n--- project-doc ---\n\n";

export interface ProjectDocOptions {
  cwd: string;
  maxBytes: number;
  fallbackFilenames: readonly string[];
}

export async function discoverProjectDocPaths(
  overrides: Partial<ProjectDocOptions> = {},
): Promise<string[]> {
  const options = resolveOptions(overrides);
  if (options.maxBytes <= 0) {
    return [];
  }

  const normalizedCwd = await normalizePath(options.cwd);
  const chain: string[] = [];
  const visited = new Set<string>();
  let gitRootIndex: number | null = null;
  let cursor = normalizedCwd;

  while (!visited.has(cursor)) {
    chain.push(cursor);
    visited.add(cursor);

    const gitMarker = path.join(cursor, ".git");
    if (await pathExists(gitMarker)) {
      gitRootIndex = chain.length - 1;
      break;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  const searchDirs =
    gitRootIndex !== null ? chain.slice(0, gitRootIndex + 1).reverse() : [normalizedCwd];

  const filenames = buildCandidateFilenames(options.fallbackFilenames);
  const results: string[] = [];

  for (const directory of searchDirs) {
    for (const filename of filenames) {
      const candidate = path.join(directory, filename);
      const metadata = await getMetadata(candidate);
      if (!metadata) {
        continue;
      }
      if (metadata.isFile() || metadata.isSymbolicLink()) {
        results.push(candidate);
        break;
      }
    }
  }

  return results;
}

export async function readProjectDocs(
  overrides: Partial<ProjectDocOptions> = {},
): Promise<string | null> {
  const options = resolveOptions(overrides);
  const maxBytes = Math.max(0, Math.floor(options.maxBytes));

  if (maxBytes === 0) {
    return null;
  }

  const paths = await discoverProjectDocPaths(options);
  if (paths.length === 0) {
    return null;
  }

  let remaining = maxBytes;
  const parts: string[] = [];

  for (const docPath of paths) {
    if (remaining <= 0) {
      break;
    }

    let handle: FileHandle | null = null;
    try {
      handle = await open(docPath, "r");
    } catch (error) {
      if (isNotFoundError(error)) {
        continue;
      }
      throw error;
    }

    try {
      const stats = await handle.stat();
      const size = Number(stats.size);
      if (size === 0) {
        continue;
      }

      const bytesToRead = Math.min(remaining, size);
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      if (bytesRead === 0) {
        continue;
      }

      const text = buffer.toString("utf8", 0, bytesRead);
      if (!text.trim()) {
        continue;
      }

      const previousRemaining = remaining;
      parts.push(text);
      remaining = Math.max(0, remaining - bytesRead);

      if (size > bytesRead) {
        console.warn(
          `Project doc ${docPath} exceeds remaining budget (${previousRemaining} bytes) - truncating.`,
        );
      }
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

function resolveOptions(overrides: Partial<ProjectDocOptions>): ProjectDocOptions {
  return {
    cwd: overrides.cwd ?? workspaceRoot,
    maxBytes: overrides.maxBytes ?? projectDocMaxBytes,
    fallbackFilenames: overrides.fallbackFilenames ?? projectDocFallbackFilenames,
  };
}

async function normalizePath(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

async function pathExists(target: string): Promise<boolean> {
  const metadata = await getMetadata(target);
  return Boolean(metadata);
}

async function getMetadata(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function buildCandidateFilenames(fallbacks: readonly string[]): string[] {
  const ordered = new Set<string>();
  ordered.add(DEFAULT_PROJECT_DOC_FILENAME);
  for (const fallback of fallbacks) {
    const trimmed = fallback.trim();
    if (!trimmed || trimmed === DEFAULT_PROJECT_DOC_FILENAME) {
      continue;
    }
    ordered.add(trimmed);
  }
  return Array.from(ordered);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}
