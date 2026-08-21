import * as fsProm from "node:fs/promises";
import * as nodePath from "node:path";

/**
 * Filesystem containment guard: resolves a user-supplied path against the
 * workspace root (realpath of process.cwd()) and rejects anything that
 * escapes it — including `..` and symlinks pointing outside.
 */
export async function resolveInsideRoot(
  inputPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const root = await allowedRoot();
  const abs = nodePath.resolve(root, inputPath);
  if (!isInside(root, abs)) {
    return {
      ok: false,
      error: `Path escapes the workspace root (${root}): "${inputPath}"`,
    };
  }
  // Resolve existing components one at a time. `realpath(abs)` fails for a
  // new file, but an existing parent can still be a symlink outside root.
  const components = nodePath.relative(root, abs).split(nodePath.sep).filter(Boolean);
  let current = root;
  for (const [index, component] of components.entries()) {
    const candidate = nodePath.join(current, component);
    try {
      const stat = await fsProm.lstat(candidate);
      if (stat.isSymbolicLink()) {
        const real = await fsProm.realpath(candidate);
        if (!isInside(root, real)) {
          return {
            ok: false,
            error: `Path resolves outside the workspace root (${root}) via symlink: "${inputPath}"`,
          };
        }
        current = real;
      } else {
        current = candidate;
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        // current is symlink resolved
        return { ok: true, path: nodePath.join(current, ...components.slice(index)) };
      }
      return {
        ok: false,
        error: `Failed to resolve path "${inputPath}": ${String(error)}`,
      };
    }
  }

  return { ok: true, path: current };
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = nodePath.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !nodePath.isAbsolute(rel);
}

/** The real (symlink-free) workspace root — process.cwd() at startup. */
export async function allowedRoot(): Promise<string> {
  try {
    return await fsProm.realpath(process.cwd());
  } catch {
    return process.cwd();
  }
}
