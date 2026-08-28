import * as z from "zod";

export const lsSchema = z.object({
  path: z.string().describe("Directory to list (relative paths resolve against cwd)"),
  showHidden: z.boolean().default(true).describe("Include hidden (dotfile) entries"),
});

export type LsEntryType = "dir" | "file";

export interface LsResult {
  truncated: boolean;
  entries: {
    path: string;
    type: LsEntryType;
  }[];
}
