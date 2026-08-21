/**
 * bash_exec: run bash commands, sandboxed by default.
 *
 * Sandboxed path (docs/bash_exec_plan.md):
 * - Bubblewrap (`bwrap`) is the security boundary; the workspace is mounted at
 *   /workspace and host paths never enter the sandbox.
 * - No network, no host home mount, cleared environment, dropped capabilities.
 *
 * Unsandboxed path (sandbox: false) runs directly on the host without
 * isolation; restrictions are a later concern.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as z from "zod";
import { ANSI_LIGHT_ORANGE, ANSI_RESET } from "../constants.js";
import { logger } from "../../config/logger.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { allowedRoot, resolveInsideRoot } from "./fs_guard.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
export const MAX_OUTPUT_BYTES = 1_000_000;

const SANDBOX_WORKSPACE = "/workspace";
const SANDBOX_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SANDBOX_HOME = "/tmp";
const RUNTIME_RO_BINDS = ["/usr", "/etc"];
// On modern distros these are symlinks into /usr; bind them either way so
// scripts resolving /bin/sh etc. work inside the sandbox.
const RUNTIME_COMPAT_LINKS = ["/bin", "/sbin", "/lib", "/lib64"];

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

interface BoundedOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export const bashExecToolDefinition: ToolDefinition<typeof bashExecSchema> = {
  type: "function",
  function: {
    name: "bash_exec",
    description:
      "Execute a bash statement. Sandboxed by default: Bubblewrap isolates the process with the workspace mounted at /workspace, no network access, and a bounded timeout; use it for builds, tests, git and other project commands. Set sandbox:false to run directly on the host without isolation.",
    label: "bash_exec",
    emoji: "\u{1F4BB}",
    parameters: bashExecSchema,
    execute: async (toolId, { command, cwd, sandbox, writable, timeoutMs }): Promise<ToolResult> => {
      const root = await allowedRoot();
      const guarded = await resolveInsideRoot(cwd ?? ".");
      if (!guarded.ok) {
        return toolError(toolId, guarded.error, command);
      }
      try {
        const result = sandbox
          ? await bashExecSb(command, root, guarded.path, writable, timeoutMs)
          : await bashExec(command, guarded.path, timeoutMs);
        return { tool_call_id: toolId, content: JSON.stringify(result), isError: false };
      } catch (err) {
        return toolError(toolId, String(err), command);
      }
    },
  },
};

/** Unsandboxed execution via Bun shell: bash -c <command> directly on the host. */
async function bashExec(command: string, hostCwd: string, timeoutMs: number): Promise<BashExecResult> {
  // Bun 1.3's ShellPromise exposes no abort/kill API, so the timeout kill
  // switch is enforced by GNU timeout wrapped around the command (exit 124).
  const timeoutPath = findExecutable("timeout");
  if (!timeoutPath) throw new Error("coreutils 'timeout' is not available on PATH");

  logger.info({ event: "bash_exec_unsandboxed", command }, `bash command: ${command}`);

  const seconds = (timeoutMs / 1000).toFixed(3);
  const proc = await Bun.$`${timeoutPath} -k 1 ${seconds}s bash -c ${command}`.cwd(hostCwd).quiet().nothrow();

  const stdout = cappedText(proc.stdout as Buffer);
  const stderr = cappedText(proc.stderr as Buffer);
  return {
    command,
    cwd: hostCwd,
    exitCode: proc.exitCode,
    signal: null,
    timedOut: proc.exitCode === 124,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
}

function cappedText(data: Buffer): { text: string; truncated: boolean } {
  if (data.length <= MAX_OUTPUT_BYTES) return { text: data.toString("utf8"), truncated: false };
  return { text: data.subarray(0, MAX_OUTPUT_BYTES).toString("utf8"), truncated: true };
}

/** Sandboxed execution: bwrap <sandbox args> -- bash -c <command>. */
async function bashExecSb(
  command: string,
  workspaceRoot: string,
  hostCwd: string,
  writable: boolean,
  timeoutMs: number,
): Promise<BashExecResult> {
  const bwrapPath = findExecutable("bwrap");
  if (!bwrapPath) throw new Error("Bubblewrap (bwrap) is not available on PATH");
  const bashPath = findExecutable("bash");
  if (!bashPath) throw new Error("bash is not available on PATH");

  // Host path -> sandbox path: <workspace>/src -> /workspace/src
  const sandboxCwd = nodePath.join(SANDBOX_WORKSPACE, nodePath.relative(workspaceRoot, hostCwd));
  const argv = [bwrapPath, ...buildSandboxArgs(workspaceRoot, sandboxCwd, writable), "--", bashPath, "-c", command];

  logger.info({ event: "bash_exec", command }, `${ANSI_LIGHT_ORANGE}sandboxed bash command: ${command}${ANSI_RESET}`);
  const outcome = await runBounded(argv, { timeoutMs });
  return { command, cwd: sandboxCwd, ...outcome };
}

function buildSandboxArgs(workspaceRoot: string, sandboxCwd: string, writable: boolean): string[] {
  const args = [
    "--unshare-all",
    "--unshare-net",
    "--clearenv",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--die-with-parent",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ];

  for (const dir of RUNTIME_RO_BINDS) {
    if (isDirectory(dir)) args.push("--ro-bind", dir, dir);
  }
  for (const link of RUNTIME_COMPAT_LINKS) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(link);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) args.push("--symlink", `usr${link}`, link);
    else if (stat.isDirectory()) args.push("--ro-bind", link, link);
  }

  // Mirror host PATH directories not covered by the runtime binds so tools
  // like bun or go resolve inside the sandbox; binding at the identical path
  // keeps absolute symlinks (e.g. bunx -> ~/.bun/bin/bun) valid.
  const extraDirs = extraPathDirs();
  for (const dir of extraDirs) args.push("--ro-bind", dir, dir);

  args.push(writable ? "--bind" : "--ro-bind", workspaceRoot, SANDBOX_WORKSPACE);
  args.push("--chdir", sandboxCwd);
  args.push("--setenv", "PATH", [...extraDirs, SANDBOX_PATH].join(":"));
  args.push("--setenv", "HOME", SANDBOX_HOME);
  return args;
}

function extraPathDirs(): string[] {
  const boundRoots = [...RUNTIME_RO_BINDS, ...RUNTIME_COMPAT_LINKS];
  const isCovered = (dir: string): boolean => boundRoots.some(root => dir === root || dir.startsWith(`${root}/`));

  const seen = new Set<string>();
  const extra: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(nodePath.delimiter)) {
    if (!dir || seen.has(dir) || isCovered(dir) || !isDirectory(dir)) continue;
    seen.add(dir);
    extra.push(dir);
  }
  return extra;
}

/**
 * Bounded process execution with an argument-array launcher. The child starts
 * in its own host-side process group (detached), so timeouts kill the whole
 * group rather than only the launcher.
 */
function runBounded(argv: string[], options: { cwd?: string; timeoutMs: number }): Promise<BoundedOutcome> {
  return new Promise((resolve, reject) => {
    const [executable, ...spawnArgs] = argv;
    if (!executable) throw new Error("empty command argv");
    const child = cp.spawn(executable, spawnArgs, {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"] as const,
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      const isOut = stream === "stdout";
      const current = isOut ? stdout : stderr;
      if (current.length >= MAX_OUTPUT_BYTES) {
        if (isOut) stdoutTruncated = true;
        else stderrTruncated = true;
        return;
      }
      const room = MAX_OUTPUT_BYTES - current.length;
      const clipped = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (isOut) {
        stdout = Buffer.concat([current, clipped]);
        stdoutTruncated ||= clipped.length < chunk.length;
      } else {
        stderr = Buffer.concat([current, clipped]);
        stderrTruncated ||= clipped.length < chunk.length;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child);
    }, options.timeoutMs);

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };

    child.on("error", err => {
      finish(() => reject(new Error(`failed to start "${executable}": ${err.message}`)));
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() =>
        resolve({
          exitCode: code,
          signal,
          timedOut,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          stdoutTruncated,
          stderrTruncated,
        }),
      );
    });
  });
}

function killProcessGroup(child: cp.ChildProcess): void {
  const pgid = child.pid;
  // Negative PID signals the whole group; never signal our own group.
  if (!pgid || pgid === process.pid) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
}

function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(nodePath.delimiter)) {
    if (!dir) continue;
    const candidate = nodePath.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function toolError(toolId: string, error: string, command: string): ToolResult {
  return {
    tool_call_id: toolId,
    content: JSON.stringify({ error, command }),
    isError: true,
  };
}
