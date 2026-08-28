import * as z from "zod";

export const editFileOpSchema = z.discriminatedUnion("function", [
  z.object({
    function: z.literal("edit").describe("Op kind: edit — replaces a column range on one line"),
    lineNo: z.number().int().min(1).describe("1-indexed line number to edit"),
    start: z.number().int().min(0).describe("Start column (0-based, inclusive), UTF-16 code units"),
    end: z
      .number()
      .int()
      .min(-1)
      .describe(
        "End column (0-based, EXCLUSIVE); the [start,end) span is replaced; -1 means 'rest of the line' (no length math needed)",
      ),
    text: z
      .string()
      .describe(
        "Replacement text; may contain newlines to expand into multiple lines; use the 'delete' or 'replace' op for whole-line changes, or empty text (\"\") to delete just the [start,end) span",
      ),
  }),
  z.object({
    function: z.literal("insert").describe("Op kind: insert — inserts text at a column on one line"),
    lineNo: z.number().int().min(1).describe("1-indexed line number; lines.length+1 appends at end of file"),
    start: z
      .number()
      .int()
      .min(0)
      .describe("Column (0-based, inclusive), UTF-16 code units; must be 0 for end-of-file insert"),
    text: z.string().describe("Text to insert; may contain newlines to add multiple lines"),
  }),
  z.object({
    function: z.literal("delete").describe("Op kind: delete — removes whole lines"),
    lineNo: z.number().int().min(1).describe("1-indexed first line to delete"),
    count: z.number().int().min(1).default(1).describe("Number of lines to delete (default 1)"),
  }),
  z.object({
    function: z.literal("replace").describe("Op kind: replace — swaps a whole-line block for new text in one op"),
    lineNo: z.number().int().min(1).describe("1-indexed first line to replace"),
    count: z.number().int().min(1).default(1).describe("Number of lines to replace (default 1)"),
    text: z.string().describe("Replacement text; may contain newlines; replaces the `count` lines starting at lineNo"),
  }),
]);

export const editFileSchema = z.object({
  path: z
    .string()
    .readonly()
    .describe("Path to the file to edit (relative paths resolve against cwd); file must exist"),
  ops: z
    .array(editFileOpSchema)
    .describe("Edit ops, applied atomically as one batch — all validated before any mutation"),
});

export const editFileResultSchema = z.object({
  path: z.string().readonly().describe("Absolute path of the edited file"),
  edits: z
    .array(
      z.object({
        index: z.number().int().min(0).describe("0-based index into the input ops array (correlation key)"),
        function: z.enum(["edit", "insert", "delete", "replace"]).describe("Echo of the op kind"),
        error: z.string().optional().describe("Present only on the single op that failed; the failure reason"),
      }),
    )
    .describe("Per-op result echo, in input order"),
});

export type EditFileSchema = z.infer<typeof editFileSchema>;
export type EditFileOpSchema = z.infer<typeof editFileOpSchema>;
export type EditFileResultSchema = z.infer<typeof editFileResultSchema>;

export interface OpsFailure {
  index: number;
  function: "edit" | "insert" | "delete" | "replace";
  error: string;
}
