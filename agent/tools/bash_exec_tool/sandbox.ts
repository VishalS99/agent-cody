import * as fs from "node:fs";
import * as nodePath from "node:path";
import { isDirectory } from "./fs.js";

export const SANDBOX_WORKSPACE = "/workspace";
export const SANDBOX_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
export const SANDBOX_HOME = "/tmp";
export const RUNTIME_RO_BINDS = ["/usr", "/etc"];
export const RUNTIME_COMPAT_LINKS = ["/bin", "/sbin", "/lib", "/lib64"];

export function buildSandboxArgs(workspaceRoot: string, sandboxCwd: string, writable: boolean): string[] {
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
