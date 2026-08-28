import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { logger } from "../../../config/logger.js";
import type { ToolDefinition } from "../../types.js";
import { allowedRoot, resolveInsideRoot } from "../fs_guard.js";
import { type LsEntryType, type LsResult, lsSchema } from "./schema.js";

const MAX_ENTRIES = 200;

export const lsToolDefinition: ToolDefinition<typeof lsSchema> = {
  type: "function",
  function: {
    name: "ls",
    description:
      "List files and folders (flat) in the given directory, including hidden entries. Does not recurse; call ls again on a subdirectory to descend.",
    label: "ls",
    emoji: "\u{1F5C1}",
    parameters: lsSchema,
    execute: async (toolId, { path, showHidden }) => {
      const guarded = await resolveInsideRoot(path);
      if (!guarded.ok) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: guarded.error, path }),
          isError: true,
        };
      }
      const target = guarded.path;
      const root = await allowedRoot();
      try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        const result = entries
          .filter(ele => (showHidden ? true : !ele.name.startsWith(".")))
          .map(ele => ({
            path: nodePath.relative(root, nodePath.join(target, ele.name)),
            type: (ele.isDirectory() ? "dir" : "file") as LsEntryType,
          }));

        const truncated = result.length > MAX_ENTRIES;
        const lsToolCallContent: LsResult = {
          truncated,
          entries: truncated ? result.slice(0, MAX_ENTRIES) : result,
        };
        return {
          tool_call_id: toolId,
          content: JSON.stringify(lsToolCallContent),
          isError: false,
        };
      } catch (err) {
        logger.error({ event: "ls_error", toolId: toolId, path: target, err: String(err) }, "ls failed");
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: String(err), path: target }),
          isError: true,
        };
      }
    },
  },
};
