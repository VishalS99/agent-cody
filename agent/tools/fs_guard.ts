import * as nodePath from "node:path"
import * as fsProm from "node:fs/promises"

/**
 * Filesystem containment guard: resolves a user-supplied path against the
 * workspace root (realpath of process.cwd()) and rejects anything that
 * escapes it — including `..` and symlinks pointing outside.
 */
export async function resolveInsideRoot(
  inputPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const root = await allowedRoot()
  const abs = nodePath.resolve(root, inputPath)
  if (!isInside(root, abs)) {
    return {
      ok: false,
      error: `Path escapes the workspace root (${root}): "${inputPath}"`,
    }
  }
  try {
    const real = await fsProm.realpath(abs)
    if (!isInside(root, real)) {
      return {
        ok: false,
        error: `Path resolves outside the workspace root (${root}) via symlink: "${inputPath}"`,
      }
    }
    return { ok: true, path: real }
  } catch {
    // Path does not exist yet (ENOENT) — lexical check already passed; the
    // caller's own error handling reports missing files.
    return { ok: true, path: abs }
  }
}

function isInside(root: string, target: string): boolean {
  if (target === root) return true
  const rel = nodePath.relative(root, target)
  return rel !== "" && !rel.startsWith("..") && !nodePath.isAbsolute(rel)
}

/** The real (symlink-free) workspace root — process.cwd() at startup. */
export async function allowedRoot(): Promise<string> {
  try {
    return await fsProm.realpath(process.cwd())
  } catch {
    return process.cwd()
  }
}
