import * as fs from "node:fs";
import * as nodePath from "node:path";

export function findExecutable(name: string): string | null {
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

export function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}
