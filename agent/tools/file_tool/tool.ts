/**
 * files — batch create and delete files inside the workspace.
 *
 * Functions:
 *   1. create — writes a new empty file for each path (max 5 paths per call);
 *      missing parent directories are created recursively.
 *   2. delete — removes the file at each path (max 2 paths per call)
 *
 * Every path is resolved against the workspace root via resolveInsideRoot;
 * paths that escape the root (via ".." or symlinks) are rejected and reported
 * in `errors`. Paths are processed independently — one bad path does not block
 * the rest.
 */

import * as fsProm from "node:fs/promises";
import * as nodePath from "node:path";
import type { ToolDefinition, ToolResult } from "../../types.js";
import { errorCode, errorMessage } from "../../util.js";
import { resolveInsideRoot } from "../fs_guard.js";
import { type FileSchema, fileSchema } from "./schema.js";

const MAX_CREATES = 5;
const MAX_DELETES = 2;

export const fileToolDefinition: ToolDefinition<typeof fileSchema> = {
  type: "function",
  function: {
    name: "files",
    description: `Create or delete files in the workspace, in batches.

    - function "create": writes a new empty file at each path (missing parent
      directories are created recursively); max 5 paths per call.
    - function "delete": removes the file at each path; max 2 paths per call.

    All paths are resolved against the workspace root and guarded against escaping it
    (including via ".." or symlinks); any path outside the workspace is rejected and
    reported in errors. Each path is processed independently — a failure on one path
    does not block the rest.`,
    label: "Files",
    emoji: "\u{1F4C4}\u{FE0E}",
    parameters: fileSchema,
    execute: async (toolId, params: FileSchema): Promise<ToolResult> => {
      const fn = params.function;
      const max = fn === "create" ? MAX_CREATES : MAX_DELETES;

      if (params.path.length === 0) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ function: fn, path: [], errors: [] }),
          isError: false,
        };
      }
      if (params.path.length > max) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            function: fn,
            path: [],
            errors: [`too many paths (${params.path.length}); max ${max} per call for '${fn}'`],
          }),
          isError: true,
        };
      }

      const done: string[] = [];
      const errors: string[] = [];

      for (const p of params.path) {
        const guarded = await resolveInsideRoot(p);
        if (!guarded.ok) {
          errors.push(guarded.error);
          continue;
        }
        try {
          if (fn === "create") {
            const parent = nodePath.dirname(guarded.path);
            const existing = await deepestExistingPath(parent);
            const existingGuard = await resolveInsideRoot(existing);
            if (!existingGuard.ok) {
              errors.push(existingGuard.error);
              continue;
            }
            await fsProm.mkdir(parent, { recursive: true });
            const target = nodePath.join(await fsProm.realpath(parent), nodePath.basename(guarded.path));
            await fsProm.writeFile(target, "", { flag: "wx" });
            done.push(target);
          } else {
            await fsProm.unlink(guarded.path);
            done.push(guarded.path);
          }
        } catch (err) {
          const code = errorCode(err);
          if (code === "EEXIST") errors.push(`file already exists: ${p}`);
          else if (code === "ENOENT") errors.push(`file not found: ${p}`);
          else if (code === "EISDIR") errors.push(`path is a directory: ${p}`);
          else if (code === "ENOTDIR") errors.push(`a path component is a file, not a directory (cannot create ${p})`);
          else errors.push(`failed to ${fn} ${p}: ${code ?? errorMessage(err)}`);
        }
      }

      return {
        tool_call_id: toolId,
        content: JSON.stringify({ function: fn, path: done, errors }),
        isError: errors.length > 0,
      };
    },
  },
};

async function deepestExistingPath(path: string): Promise<string> {
  let cur = path;
  while (true) {
    try {
      await fsProm.access(cur);
      return cur;
    } catch (err) {
      const code = errorCode(err);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }
    const up = nodePath.dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
}
