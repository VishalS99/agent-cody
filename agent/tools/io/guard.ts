import * as fsProm from "node:fs/promises";

export const MAX_BYTES = 1_000_000;
export const BINARY_SNIFF_BYTES = 1024;

export function isBinaryBuffer(buf: Buffer): boolean {
  return buf.includes(0);
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  let fd: fsProm.FileHandle | undefined;
  try {
    fd = await fsProm.open(filePath, "r");
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    return isBinaryBuffer(buf.subarray(0, bytesRead));
  } finally {
    await fd?.close();
  }
}

export async function probeTextFile(
  filePath: string,
): Promise<{ size: number; isDirectory: boolean; isBinary: boolean }> {
  let fd: fsProm.FileHandle | undefined;
  try {
    fd = await fsProm.open(filePath, "r");
    const stats = await fd.stat();
    if (stats.isDirectory()) {
      return { size: stats.size, isDirectory: true, isBinary: false };
    }
    if (stats.size > MAX_BYTES) {
      // still sniff for callers that care, but size already over limit
      return { size: stats.size, isDirectory: false, isBinary: false };
    }
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    return {
      size: stats.size,
      isDirectory: false,
      isBinary: isBinaryBuffer(buf.subarray(0, bytesRead)),
    };
  } finally {
    await fd?.close();
  }
}
