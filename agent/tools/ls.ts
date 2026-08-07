import * as z from "zod"
import type { ToolDefinition } from "../types.js"
import * as fs from "node:fs/promises"
import { logger } from "../../config/logger.js"
import * as nodePath from "node:path"

const MAX_ENTRIES = 200

export const lsSchema = z.object({
  path: z
    .string()
    .describe("Directory to list (relative paths resolve against cwd)"),
  showHidden: z
    .boolean()
    .default(true)
    .describe("Include hidden (dotfile) entries"),
})

type lsEntryType = "dir" | "file"

interface LsResult {
  truncated: boolean
  entries: {
    path: string
    type: lsEntryType
  }[]
}

export const lsToolDefinition: ToolDefinition<typeof lsSchema> = {
  type: "function",
  function: {
    name: "ls",
    description:
      "List files and folders (flat) in the given directory, including hidden entries. Does not recurse; call ls again on a subdirectory to descend.",
    label: "ls",
    parameters: lsSchema,
    execute: async (toolId, { path, showHidden }) => {
      path = nodePath.resolve(path)
      try {
        const entries = await fs.readdir(path, { withFileTypes: true })
        const result = entries
          .filter((ele) => (showHidden ? true : !ele.name.startsWith(".")))
          .map((ele) => ({
            path: nodePath.relative(
              process.cwd(),
              nodePath.join(path, ele.name),
            ),
            type: (ele.isDirectory() ? "dir" : "file") as lsEntryType,
          }))

        const truncated = result.length > MAX_ENTRIES
        const lsToolCallContent: LsResult = {
          truncated,
          entries: truncated ? result.slice(0, MAX_ENTRIES) : result,
        }
        return {
          tool_call_id: toolId,
          content: JSON.stringify(lsToolCallContent),
          isError: false,
        }
      } catch (err) {
        logger.error(
          { event: "ls_error", toolId: toolId, path, err: String(err) },
          "ls failed",
        )
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: String(err), path }),
          isError: true,
        }
      }
    },
  },
}
