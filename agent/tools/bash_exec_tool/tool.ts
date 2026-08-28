/**
 * bash_exec: run bash commands, sandboxed by default.
 *
 * Sandboxed path (docs/bash_exec_plan.md):
 * - Bubblewrap (`bwrap`) is the security boundary; the workspace is mounted at
 *   /workspace and host paths never enter the sandbox.
 * - No network, no host home mount, cleared environment, dropped capabilities.
 *
 * Unsandboxed path (sandbox: false) runs directly on the host without
 * isolation; restrictions are a later concern.
 */

import type { ToolDefinition, ToolResult } from "../../types.js";
import { allowedRoot, resolveInsideRoot } from "../fs_guard.js";
import { bashExec, bashExecSb } from "./exec.js";
import { bashExecSchema } from "./schema.js";

export const bashExecToolDefinition: ToolDefinition<typeof bashExecSchema> = {
  type: "function",
  function: {
    name: "bash_exec",
    description:
      "Execute a bash statement. Sandboxed by default: Bubblewrap isolates the process with the workspace mounted at /workspace, no network access, and a bounded timeout; use it for builds, tests, git and other project commands. Set sandbox:false to run directly on the host without isolation.",
    label: "bash_exec",
    emoji: "\u{1F4BB}",
    parameters: bashExecSchema,
    execute: async (toolId, { command, cwd, sandbox, writable, timeoutMs }): Promise<ToolResult> => {
      const root = await allowedRoot();
      const guarded = await resolveInsideRoot(cwd ?? ".");
      if (!guarded.ok) {
        return toolError(toolId, guarded.error, command);
      }
      try {
        const result = sandbox
          ? await bashExecSb(command, root, guarded.path, writable, timeoutMs)
          : await bashExec(command, guarded.path, timeoutMs);
        return { tool_call_id: toolId, content: JSON.stringify(result), isError: false };
      } catch (err) {
        return toolError(toolId, String(err), command);
      }
    },
  },
};

function toolError(toolId: string, error: string, command: string): ToolResult {
  return {
    tool_call_id: toolId,
    content: JSON.stringify({ error, command }),
    isError: true,
  };
}
