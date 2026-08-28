import type { EditFileOpSchema, OpsFailure } from "./schema.js";

export function validateInterOps(ops: EditFileOpSchema[]): OpsFailure | null {
  let opsValFailure: OpsFailure | null = null;
  for (const [i, opsA] of ops.entries()) {
    for (const [j, opsB] of ops.entries()) {
      if (j <= i) continue;
      if (
        (opsA.function === "delete" || opsA.function === "replace") &&
        opsB.lineNo >= opsA.lineNo &&
        opsB.lineNo <= opsA.lineNo + opsA.count - 1
      ) {
        opsValFailure = {
          index: j,
          function: opsB.function,
          error: `op ${j} (${opsB.function} on line ${opsB.lineNo}) conflicts with op ${i} (${opsA.function} of lines ${opsA.lineNo}-${opsA.lineNo + opsA.count - 1}) — move one op to a different line`,
        };
        break;
      }
      if (
        (opsB.function === "delete" || opsB.function === "replace") &&
        opsA.lineNo >= opsB.lineNo &&
        opsA.lineNo <= opsB.lineNo + opsB.count - 1
      ) {
        opsValFailure = {
          index: i,
          function: opsA.function,
          error: `op ${i} (${opsA.function} on line ${opsA.lineNo}) conflicts with op ${j} (${opsB.function} of lines ${opsB.lineNo}-${opsB.lineNo + opsB.count - 1}) — move one op to a different line`,
        };
        break;
      }
      if (
        opsA.function === "edit" &&
        opsB.function === "edit" &&
        opsA.lineNo === opsB.lineNo &&
        opsA.start < effectiveEditEnd(opsB.end) &&
        effectiveEditEnd(opsA.end) > opsB.start
      ) {
        opsValFailure = {
          index: i,
          function: "edit",
          error: `op ${i} edit [${opsA.start}, ${effectiveEditEnd(opsA.end)}) overlaps op ${j} edit [${opsB.start}, ${effectiveEditEnd(opsB.end)}) on line ${opsA.lineNo} — adjust one range`,
        };
        break;
      }
      if (
        opsA.function === "edit" &&
        opsB.function === "insert" &&
        opsA.lineNo === opsB.lineNo &&
        opsA.start <= opsB.start &&
        opsB.start < effectiveEditEnd(opsA.end)
      ) {
        opsValFailure = {
          index: i,
          function: "edit",
          error: `op ${j} insert at col ${opsB.start} lands inside op ${i} edit [${opsA.start}, ${effectiveEditEnd(opsA.end)}) on line ${opsA.lineNo} — move the insert or shrink the edit range`,
        };
        break;
      }
      if (
        opsA.function === "insert" &&
        opsB.function === "edit" &&
        opsA.lineNo === opsB.lineNo &&
        opsB.start <= opsA.start &&
        opsA.start < effectiveEditEnd(opsB.end)
      ) {
        opsValFailure = {
          index: i,
          function: "insert",
          error: `op ${i} insert at col ${opsA.start} lands inside op ${j} edit [${opsB.start}, ${effectiveEditEnd(opsB.end)}) on line ${opsA.lineNo} — move the insert or shrink the edit range`,
        };
        break;
      }
      if (
        opsA.function === "insert" &&
        opsB.function === "insert" &&
        opsA.lineNo === opsB.lineNo &&
        opsA.start === opsB.start
      ) {
        opsValFailure = {
          index: i,
          function: "insert",
          error: `op ${i} and op ${j} both insert at (line ${opsA.lineNo}, col ${opsA.start}) — ambiguous order; merge into one insert with "\\n"-joined text`,
        };
        break;
      }
    }
    if (opsValFailure) break;
  }
  return opsValFailure;
}

function effectiveEditEnd(end: number): number {
  return end === -1 ? Number.MAX_SAFE_INTEGER : end;
}

export function validateOps(op: EditFileOpSchema, opIndx: number, lines: string[]): OpsFailure | null {
  let failure: OpsFailure = { index: opIndx, function: op.function, error: "" };
  switch (op.function) {
    case "edit": {
      const { lineNo, start, end } = op;
      if (lineNo > lines.length) {
        failure = {
          index: opIndx,
          function: "edit",
          error: `line ${lineNo} out of range (file has ${lines.length} lines)`,
        };
        break;
      }
      const targetLine = lines[lineNo - 1];
      if (targetLine === undefined) {
        failure.error = `line ${lineNo} does not exist`;
        break;
      }
      const resolvedEnd = end === -1 ? targetLine.length : end;
      if (start > targetLine.length) {
        failure.error = `start ${start} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`;
        break;
      }
      if (resolvedEnd > targetLine.length) {
        failure.error = `end ${end} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`;
        break;
      }
      if (start > resolvedEnd) {
        failure.error = `start ${start} must be less than or equal to end ${end}`;
        break;
      }
      if (isLowSurrogate(targetLine, start)) {
        failure.error = `start ${start} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`;
        break;
      }
      if (isLowSurrogate(targetLine, resolvedEnd)) {
        failure.error = `end ${end} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`;
        break;
      }
      break;
    }
    case "insert": {
      const { lineNo, start } = op;
      if (lineNo > lines.length + 1) {
        failure.error = `line ${lineNo} out of range (file has ${lines.length} lines)`;
        break;
      }
      if (lineNo === lines.length + 1) {
        if (start !== 0) {
          failure.error = `start ${start} invalid for end-of-file insert (lineNo ${lineNo}); start must be 0`;
        }
        break;
      }
      const targetLine = lines[lineNo - 1];
      if (targetLine === undefined) {
        failure.error = `line ${lineNo} does not exist`;
        break;
      }
      if (start > targetLine.length) {
        failure.error = `start ${start} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`;
        break;
      }
      if (isLowSurrogate(targetLine, start)) {
        failure.error = `start ${start} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`;
        break;
      }
      break;
    }
    case "delete":
    case "replace": {
      const { lineNo, count } = op;
      const fn = op.function;
      if (lineNo > lines.length) {
        failure.error = `line ${lineNo} out of range (file has ${lines.length} lines)`;
        break;
      }
      if (lineNo + count - 1 > lines.length) {
        failure.error = `${fn} range [${lineNo}, ${lineNo + count - 1}] exceeds file length (${lines.length} lines)`;
        break;
      }
      break;
    }
  }
  return failure.error ? failure : null;
}

function isLowSurrogate(line: string, col: number): boolean {
  const code = line.charCodeAt(col);
  return code >= 0xdc00 && code <= 0xdfff;
}

function linePreview(line: string, max = 80): string {
  return line.length <= max ? line : `${line.slice(0, max)}…`;
}
