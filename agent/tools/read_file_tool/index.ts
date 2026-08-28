import * as fs from "node:fs";
import * as fsProm from "node:fs/promises";
import readline from "node:readline";
import { logger } from "../../../config/logger.js";
import type { ToolDefinition, ToolResult } from "../../types.js";
import { resolveInsideRoot } from "../fs_guard.js";
import { BINARY_SNIFF_BYTES, isBinaryBuffer, MAX_BYTES } from "../io/guard.js";
import { type FileReadResult, fileReadSchema } from "./schema.js";

const MAX_LINES = 1000;

export const readFileToolDefinition: ToolDefinition<typeof fileReadSchema> = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read a text file and return content with line numbers. Use when you need to inspect or reference file contents (before editing, or to understand code). Use offset/limit to read large files in chunks.",
    label: "read_file",
    emoji: "\u{1F5CF}",
    parameters: fileReadSchema,
    execute: async (toolId, { path, offset = 1, limit }): Promise<ToolResult> => {
      const guarded = await resolveInsideRoot(path);
      if (!guarded.ok) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: guarded.error, path }),
          isError: true,
        };
      }
      const resolvedPath = guarded.path;
      try {
        const stat = await fsProm.stat(resolvedPath);
        if (stat.size > MAX_BYTES) {
          return {
            tool_call_id: toolId,
            content: JSON.stringify({
              resolvedPath,
              error: `file too large: ${stat.size} bytes exceeds ${MAX_BYTES} byte limit`,
            }),
            isError: true,
          };
        }
        const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
        const fd = await fsProm.open(resolvedPath, "r");
        const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0);
        await fd.close();
        const sniff = buf.subarray(0, bytesRead);
        if (isBinaryBuffer(sniff)) {
          return {
            tool_call_id: toolId,
            content: JSON.stringify({
              resolvedPath,
              totalLineCount: 0,
              offset: 1,
              limit: 0,
              truncated: false,
              isBinary: true,
              bytes: stat.size,
              content: [],
            }),
            isError: false,
          };
        }
        limit = limit ?? MAX_LINES;
        const res = await readFileFromLineOffset(resolvedPath, offset, limit);

        const result: FileReadResult = {
          path: resolvedPath,
          totalLineCount: res.totalLineCount,
          offset: offset,
          limit: limit,
          truncated: res.isTruncated,
          content: res.content,
        };
        return {
          tool_call_id: toolId,
          content: JSON.stringify(result),
          isError: false,
          contextUpdate: {
            type: "update_state",
            files_read: resolvedPath,
          },
        };
      } catch (err) {
        logger.error({ event: "read_file_error", toolId, resolvedPath, err: String(err) }, "read_file failed");
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: String(err), resolvedPath }),
          isError: true,
        };
      }
    },
  },
};

async function readFileFromLineOffset(filePath: string, lineOffset: number, limit: number) {
  const fileStream = fs.createReadStream(filePath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentLineNo = 0;
  let isTruncated: boolean = false;
  const content: { lineNo: number; line: string }[] = [];

  const startReadLine = lineOffset;
  const endReadLine = lineOffset + limit - 1;

  for await (const line of rl) {
    currentLineNo++;
    if (currentLineNo < startReadLine || currentLineNo > endReadLine) continue;
    if (content.length < limit && !isTruncated) {
      content.push({ lineNo: currentLineNo, line });
      if (content.length === limit) isTruncated = true;
    }
  }

  return {
    content: content,
    isTruncated: isTruncated,
    totalLineCount: currentLineNo,
  };
}
