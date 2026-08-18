import * as fs from "node:fs";
import * as fsProm from "node:fs/promises";
import readline from "node:readline";
import * as z from "zod";
import { logger } from "../../config/logger.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { resolveInsideRoot } from "./fs_guard.js";

const MAX_LINES = 1000;
const MAX_BYTES = 1_000_000;
const BINARY_SNIFF_BYTES = 1024;

export const fileReadSchema = z.object({
  path: z.string().describe("Path to file (relative paths resolve against cwd)"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Line number to start reading from, starting with 1; omit for one shot full file read "),
  limit: z.number().int().min(1).optional().describe("Max lines to return; omit for default cap (1000)"),
});

export const fileReadResultSchema = z.object({
  path: z.string().describe("Absolute path to file"),
  totalLineCount: z.number().int().min(0).describe("Total number of lines to read in the file"),
  offset: z
    .number()
    .int()
    .min(1)
    .describe("Line number to start reading from, starting with 1; omit for one shot full file read "),
  limit: z.number().int().min(1).describe("Lines actually returned in this response"),
  truncated: z.boolean().default(false).describe("Whether file read is in full(false) or in batches(true)"),
  isBinary: z.boolean().optional(),
  bytes: z.number().int().min(0).optional(),
  content: z.array(
    z.object({
      lineNo: z.number().int().min(1).describe("Current line's line number indexed from offset"),
      line: z.string().describe("Content in the line"),
    }),
  ),
});

export type FileReadResult = z.infer<typeof fileReadResultSchema>;

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
        // 2. Binary sniff — read first 1 KB, check for NUL bytes.
        const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
        const fd = await fsProm.open(resolvedPath, "r");
        const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0);
        await fd.close();
        const sniff = buf.subarray(0, bytesRead);
        if (sniff.indexOf(0) !== -1) {
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
    crlfDelay: Infinity, // Handles both Windows (\r\n) and Unix (\n) breaks
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
