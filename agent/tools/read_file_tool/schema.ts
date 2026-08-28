import * as z from "zod";

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
