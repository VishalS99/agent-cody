import * as z from "zod";
import type { ToolDefinition } from "../types.js";
import { logger } from "../../config/logger.js";
import * as nodePath from "node:path";
import * as fs from "node:fs/promises";
import * as fastGlob from "fast-glob";
import { resolveInsideRoot } from "./fs_guard.js";

export const grepSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("Root directory to search (default: cwd)"),
  include: z.string().optional().describe("Glob pattern for files (e.g. '*.ts', 'src/**/*.ts')"),
  caseInsensitive: z.boolean().default(false).describe("Case-insensitive search"),
  contextLines: z.number().int().min(0).max(10).default(2).describe("Lines of context around each match"),
  maxResults: z.number().int().min(1).max(500).default(100).describe("Maximum matches to return"),
});
export type GrepParams = z.infer<typeof grepSchema>;

export interface GrepMatch {
  file: string;
  line: number;
  context: { line: number; text: string }[];
}

export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
}

async function* walkFiles(root: string, include?: string): AsyncGenerator<string> {
  const pattern = include ?? "**/*";
  const entries = fastGlob.stream(pattern, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.turbo/**", "**/*.log"],
  });

  for await (const entry of entries) {
    yield String(entry);
  }
}

async function searchFile(filePath: string, regex: RegExp, contextLines: number): Promise<GrepMatch[]> {
  const content = await fs.readFile(filePath, "utf-8");
  // Quick binary check (null byte detection)
  if (content.includes("\0")) return [];

  const lines = content.split(/\r?\n/);
  const matches: GrepMatch[] = [];
  let lineCount = 0;

  for (const line of lines) {
    regex.lastIndex = 0; // Reset state for /g flag safety
    if (regex.test(line)) {
      const start = Math.max(0, lineCount - contextLines);
      const end = Math.min(lines.length, lineCount + contextLines + 1);

      matches.push({
        file: filePath,
        line: lineCount + 1,
        context: lines.slice(start, end).map((text, idx) => ({
          line: start + idx + 1,
          text,
        })),
      });
    }
    lineCount++;
  }

  return matches;
}

export const grepToolDefinition: ToolDefinition<typeof grepSchema> = {
  type: "function",
  function: {
    name: "simple_grep",
    description:
      "Search files for a regex pattern using in-memory TypeScript scanning. Returns matches with context lines.",
    label: "simple_grep",
    emoji: "\u{2315}",
    parameters: grepSchema,
    execute: async (toolId, { pattern, path, include, caseInsensitive, contextLines, maxResults }) => {
      const guarded = await resolveInsideRoot(path ?? ".");
      if (!guarded.ok) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: guarded.error, pattern }),
          isError: true,
        };
      }
      const cwd = guarded.path;
      const flags = caseInsensitive ? "gi" : "g";
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, flags);
      } catch (err) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            error: `Invalid regular expression: ${String(err)}`,
            pattern,
          }),
          isError: true,
        };
      }

      try {
        const matches: GrepMatch[] = [];
        let truncated = false;

        for await (const file of walkFiles(cwd, include)) {
          const fileMatches = await searchFile(file, regex, contextLines);

          for (const match of fileMatches) {
            if (matches.length >= maxResults) {
              truncated = true;
              break;
            }
            match.file = nodePath.relative(cwd, match.file);
            matches.push(match);
          }

          if (truncated) break;
        }

        return {
          tool_call_id: toolId,
          content: JSON.stringify({ matches, truncated }),
          isError: false,
        };
      } catch (err) {
        logger.error({ event: "grep_error", toolId, pattern, path: cwd, err: String(err) }, "grep failed");
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: String(err), pattern }),
          isError: true,
        };
      }
    },
  },
};
