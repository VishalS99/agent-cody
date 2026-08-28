import * as z from "zod";

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
