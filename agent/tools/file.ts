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
import * as z from "zod"
import * as fsProm from "node:fs/promises"
import * as nodePath from "node:path"
import type { ToolDefinition, ToolResult } from "../types.js"
import { resolveInsideRoot } from "./fs_guard.js"

const MAX_CREATES = 5
const MAX_DELETES = 2

export const fileSchema = z.object({
  path: z
    .array(
      z
        .string()
        .readonly()
        .describe(
          "List of file paths (relative paths resolve against cwd; all paths must stay within the workspace root)",
        ),
    )
    .describe(
      "Paths to create or delete; max 5 for 'create', max 2 for 'delete'",
    ),
  function: z
    .enum(["create", "delete"])
    .describe(
      "'create' writes a new empty file at each path (parent dirs are created recursively; max 5 paths per call); 'delete' removes the file at each path (max 2 paths per call)",
    ),
})

export const fileResultSchema = z.object({
  function: z
    .enum(["create", "delete"])
    .describe("Echo of the operation that was performed"),
  path: z
    .array(z.string().readonly())
    .describe(
      "Absolute paths of files successfully created/deleted (in input order)",
    ),
  errors: z
    .array(z.string().describe("Error logs if any"))
    .describe("Per-path failure messages; one entry per failed path"),
})

export type FileSchema = z.infer<typeof fileSchema>
export type FileResultSchema = z.infer<typeof fileResultSchema>

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
    parameters: fileSchema,
    execute: async (toolId, params: FileSchema): Promise<ToolResult> => {
      const fn = params.function
      const max = fn === "create" ? MAX_CREATES : MAX_DELETES

      if (params.path.length === 0) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ function: fn, path: [], errors: [] }),
          isError: false,
        }
      }
      if (params.path.length > max) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            function: fn,
            path: [],
            errors: [
              `too many paths (${params.path.length}); max ${max} per call for '${fn}'`,
            ],
          }),
          isError: true,
        }
      }

      const done: string[] = []
      const errors: string[] = []

      for (const p of params.path) {
        const guarded = await resolveInsideRoot(p)
        if (!guarded.ok) {
          errors.push(guarded.error)
          continue
        }
        try {
          if (fn === "create") {
            // Guard the deepest EXISTING ancestor before creating anything:
            // realpath on it resolves every symlink in the existing chain, so a
            // parent or grandparent symlink pointing outside the root is caught
            // BEFORE any directory is created. Everything created below it is
            // fresh, so no later check can be bypassed.
            const parent = nodePath.dirname(guarded.path)
            const existing = await deepestExistingPath(parent)
            const existingGuard = await resolveInsideRoot(existing)
            if (!existingGuard.ok) {
              errors.push(existingGuard.error)
              continue
            }
            await fsProm.mkdir(parent, { recursive: true })
            const target = nodePath.join(
              await fsProm.realpath(parent),
              nodePath.basename(guarded.path),
            )
            await fsProm.writeFile(target, "", { flag: "wx" })
            done.push(target)
          } else {
            await fsProm.unlink(guarded.path)
            done.push(guarded.path)
          }
        } catch (err: any) {
          if (err.code === "EEXIST")
            errors.push(`file already exists: ${p}`)
          else if (err.code === "ENOENT")
            errors.push(`file not found: ${p}`)
          else if (err.code === "EISDIR")
            errors.push(`path is a directory: ${p}`)
          else if (err.code === "ENOTDIR")
            errors.push(`a path component is a file, not a directory (cannot create ${p})`,)
          else
            errors.push(`failed to ${fn} ${p}: ${err.code || err.message}`)
        }
      }

      return {
        tool_call_id: toolId,
        content: JSON.stringify({ function: fn, path: done, errors }),
        isError: errors.length > 0,
      }
    },
  },
}

/** Walks up from `path` until it finds a component that exists on disk. */
async function deepestExistingPath(path: string): Promise<string> {
  let cur = path
  while (true) {
    try {
      await fsProm.access(cur)
      return cur
    } catch (err: any) {
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err
    }
    const up = nodePath.dirname(cur)
    if (up === cur) return cur
    cur = up
  }
}
