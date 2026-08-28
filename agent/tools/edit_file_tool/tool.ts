/**
 * edit_file — batched, atomic, in-place edits to an existing text file.
 *
 * Ops (each carries only its own fields):
 *   edit:    { lineNo, start, end, text } — replace [start,end) columns with text; empty text deletes the span; end:-1 = rest of line
 *   insert:  { lineNo, start, text }      — insert text at column start (text may contain "\n")
 *   delete:  { lineNo, count = 1 }        — remove `count` whole lines (complete-line deletes only)
 *   replace: { lineNo, count = 1, text }  — replace `count` whole lines with text (swap a line block)
 *
 * Indexing: lineNo 1-indexed, start/end UTF-16 code units — matches read_file (no phantom
 * trailing line; "\r\n" stripped). All ops target ORIGINAL-file coordinates.
 *
 * Contract: validate everything before mutating; write-back via temp file + rename (atomic);
 * on any failure the file is untouched and isError:true. Ops apply sorted by (lineNo desc,
 * start desc). Overlapping/ambiguous ops (same-line ranges, same-point inserts, delete vs an
 * op in its range) are rejected. Only text files: binaries, dirs, >1MB rejected.
 *
 * Response: success/op-failure -> { path, edits: [{ index, function, error? }] } (input order,
 * error only on the single failing op); file-level failure -> { path, error }.
 */

import * as fsProm from "node:fs/promises";
import type { ToolDefinition, ToolResult } from "../../types.js";
import { resolveInsideRoot } from "../fs_guard.js";
import { applyOps } from "./apply.js";
import { assertFileForEdit, atomicWrite } from "./io.js";
import type { OpsFailure } from "./schema.js";
import { type EditFileSchema, editFileSchema } from "./schema.js";
import { validateInterOps, validateOps } from "./validate.js";

const MAX_OPS = 200;

export const editFileToolDefinition: ToolDefinition<typeof editFileSchema> = {
  type: "function",
  function: {
    name: "edit_file",
    description: `Apply a batched sequence of atomic edits (edit/insert/delete/replace) to an existing text file. All ops are
    validated before any mutation — on any failure the file is untouched. 'delete' removes whole lines — use it for ANY
    whole-line change. 'replace' swaps a whole-line block for new text in one op: {lineNo, count, text} removes 'count' lines
    starting at lineNo and inserts text in their place — use it to rewrite a range of lines. 'edit' replaces ONLY the
    [start,end) column span on one line (end EXCLUSIVE): e.g. "abc def" with edit {lineNo:1, start:0, end:3, text:"XY"} yields
    "XY def"; text:"" deletes just the span; end:-1 means "to the end of the line". Never replace a whole line via 'edit' by
    computing its length — use 'delete' or 'replace' instead. 'insert' adds text at a column (may contain newlines).
    Coordinates are 1-indexed line numbers and UTF-16 code-unit column offsets (matching read_file). Only text files supported;
    binaries and oversized files are rejected. After applying edits, verify the file is in a workable state with no errors (e.g., run lint/typecheck); if errors exist, call further edits to fix them.`,
    label: "Edit File",
    emoji: "\u{1F4DD}\u{FE0E}",
    parameters: editFileSchema,
    execute: async (toolId, params: EditFileSchema): Promise<ToolResult> => {
      const { path, ops } = params;

      const guarded = await resolveInsideRoot(path);
      if (!guarded.ok) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path, error: guarded.error }),
          isError: true,
        };
      }
      const resolvedPath = guarded.path;

      if (ops.length === 0) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: resolvedPath, edits: [] }),
          isError: false,
        };
      }
      if (ops.length > MAX_OPS) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            path: resolvedPath,
            error: `too many ops (${ops.length}); max ${MAX_OPS}`,
          }),
          isError: true,
        };
      }

      const { isErr, error } = await assertFileForEdit(resolvedPath);
      if (isErr) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: resolvedPath, error }),
          isError: true,
        };
      }

      const fileContent = await fsProm.readFile(resolvedPath, {
        encoding: "utf8",
      });
      let lines: string[] = fileContent.split("\n");
      const hadTrailingNewline = fileContent.endsWith("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      lines = lines.map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));

      let opsValFailure: OpsFailure | null = null;
      for (const [i, op] of ops.entries()) {
        opsValFailure = validateOps(op, i, lines);
        if (opsValFailure) break;
      }

      if (opsValFailure) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            path: resolvedPath,
            edits: [opsValFailure],
          }),
          isError: true,
        };
      }

      opsValFailure = validateInterOps(ops);
      if (opsValFailure) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            path: resolvedPath,
            edits: [opsValFailure],
          }),
          isError: true,
        };
      }

      applyOps(lines, ops);

      await atomicWrite(resolvedPath, lines, hadTrailingNewline);

      return {
        tool_call_id: toolId,
        content: JSON.stringify({
          path: resolvedPath,
          edits: ops.map((op, index) => ({ index, function: op.function })),
        }),
        isError: false,
      };
    },
  },
};
