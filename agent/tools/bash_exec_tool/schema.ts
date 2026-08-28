import * as z from "zod";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_OUTPUT_BYTES = 1_000_000;

export const bashExecSchema = z.object({
  command: z.string().min(1).describe("Shell statement to run, e.g. 'npm test'"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Working directory for the command, relative to the workspace root; must resolve inside the workspace. Omit for the workspace root.",
    ),
  sandbox: z
    .boolean()
    .default(true)
    .describe(
      "Run inside the Bubblewrap sandbox (recommended). false executes directly on the host without isolation.",
    ),
  writable: z
    .boolean()
    .default(true)
    .describe("Allow the command to modify workspace files (false mounts it read-only)"),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_TIMEOUT_MS)
    .default(DEFAULT_TIMEOUT_MS)
    .describe(
      `Kill switch for the command in milliseconds (1s–${MAX_TIMEOUT_MS / 1000}s); default ${DEFAULT_TIMEOUT_MS / 1000}s`,
    ),
});

export const bashExecResultSchema = z.object({
  command: z.string().describe("The command that was executed"),
  cwd: z.string().describe("Working directory used (/workspace/... when sandboxed)"),
  exitCode: z.number().int().nullable().describe("Process exit code; null when the process was killed by a signal"),
  signal: z.string().nullable().describe("Signal that terminated the process (e.g. SIGKILL on timeout), if any"),
  timedOut: z.boolean().describe("Whether the command was killed after exceeding timeoutMs"),
  stdout: z.string().describe("Captured standard output (capped at MAX_OUTPUT_BYTES)"),
  stderr: z.string().describe("Captured standard error (capped at MAX_OUTPUT_BYTES)"),
  stdoutTruncated: z.boolean().describe("Whether stdout exceeded MAX_OUTPUT_BYTES and was cut off"),
  stderrTruncated: z.boolean().describe("Whether stderr exceeded MAX_OUTPUT_BYTES and was cut off"),
});

export type BashExecInput = z.infer<typeof bashExecSchema>;
export type BashExecResult = z.infer<typeof bashExecResultSchema>;
