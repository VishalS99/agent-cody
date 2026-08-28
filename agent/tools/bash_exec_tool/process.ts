import * as cp from "node:child_process";
import { MAX_OUTPUT_BYTES } from "./schema.js";

export interface BoundedOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export function cappedText(data: Buffer): { text: string; truncated: boolean } {
  if (data.length <= MAX_OUTPUT_BYTES) return { text: data.toString("utf8"), truncated: false };
  return { text: data.subarray(0, MAX_OUTPUT_BYTES).toString("utf8"), truncated: true };
}

export function runBounded(argv: string[], options: { cwd?: string; timeoutMs: number }): Promise<BoundedOutcome> {
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
