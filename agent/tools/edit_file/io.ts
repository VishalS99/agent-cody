import * as fsProm from "node:fs/promises";
import { errorCode, errorMessage } from "../../util.js";
import { BINARY_SNIFF_BYTES, isBinaryBuffer, MAX_BYTES } from "../io/guard.js";

export async function assertFileForEdit(filePath: string): Promise<{ isErr: boolean; error: string }> {
  let fd: fsProm.FileHandle | undefined;

  try {
    fd = await fsProm.open(filePath, "r");
    const stats = await fd.stat();

    if (stats.isDirectory()) {
      return { isErr: true, error: `Path is a directory: ${filePath}` };
    }

    if (stats.size > MAX_BYTES) {
      return { isErr: true, error: `File is too large (${stats.size} bytes)` };
    }
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    const sniff = buf.subarray(0, bytesRead);

    if (isBinaryBuffer(sniff)) {
      return { isErr: true, error: `File is binary: ${filePath}` };
    }
  } catch (e) {
    const code = errorCode(e);
    if (code === "ENOENT") {
      return { isErr: true, error: `File not found: ${filePath}` };
    }
    return {
      isErr: true,
      error: `Failed to access file (${code ?? errorMessage(e)}): ${filePath}`,
    };
  } finally {
    await fd?.close();
  }

  return { isErr: false, error: "" };
}

export async function atomicWrite(resolvedPath: string, lines: string[], hadTrailingNewline: boolean): Promise<void> {
  const tmpPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    const out = lines.join("\n") + (hadTrailingNewline ? "\n" : "");
    const handle = await fsProm.open(tmpPath, "w");
    try {
      await handle.writeFile(out, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsProm.rename(tmpPath, resolvedPath);
  } catch (err) {
    await fsProm.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
