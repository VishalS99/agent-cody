import * as z from "zod";

export const fileSchema = z.object({
  path: z
    .array(
      z
        .string()
        .readonly()
        .describe(
          "List of file paths (relative paths resolve against cwd; all paths must stay within the workspace root)",
        ),
    )
    .describe("Paths to create or delete; max 5 for 'create', max 2 for 'delete'"),
  function: z
    .enum(["create", "delete"])
    .describe(
      "'create' writes a new empty file at each path (parent dirs are created recursively; max 5 paths per call); 'delete' removes the file at each path (max 2 paths per call)",
    ),
});

export const fileResultSchema = z.object({
  function: z.enum(["create", "delete"]).describe("Echo of the operation that was performed"),
  path: z
    .array(z.string().readonly())
    .describe("Absolute paths of files successfully created/deleted (in input order)"),
  errors: z
    .array(z.string().describe("Error logs if any"))
    .describe("Per-path failure messages; one entry per failed path"),
});

export type FileSchema = z.infer<typeof fileSchema>;
export type FileResultSchema = z.infer<typeof fileResultSchema>;
