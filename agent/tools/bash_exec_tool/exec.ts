import * as nodePath from "node:path";
import { logger } from "../../../config/logger.js";
import { ANSI_DIM_WHITE_ITALIC, ANSI_ITALIC_GREEN, ANSI_RESET } from "../../constants.js";
import { findExecutable } from "./fs.js";
import { cappedText, runBounded } from "./process.js";
import { buildSandboxArgs, SANDBOX_WORKSPACE } from "./sandbox.js";
import type { BashExecResult } from "./schema.js";

export async function bashExec(command: string, hostCwd: string, timeoutMs: number): Promise<BashExecResult> {
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

export async function bashExecSb(
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

  const sandboxCwd = nodePath.join(SANDBOX_WORKSPACE, nodePath.relative(workspaceRoot, hostCwd));
  const argv = [bwrapPath, ...buildSandboxArgs(workspaceRoot, sandboxCwd, writable), "--", bashPath, "-c", command];

  logger.info(
    { event: "bash_exec", command },
    `${ANSI_ITALIC_GREEN}sandboxed bash command:${ANSI_RESET} ${ANSI_DIM_WHITE_ITALIC}${command}${ANSI_RESET}`,
  );
  const outcome = await runBounded(argv, { timeoutMs });
  return { command, cwd: sandboxCwd, ...outcome };
}
