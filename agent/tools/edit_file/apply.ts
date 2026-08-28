import type { EditFileOpSchema } from "./schema.js";

export function applyOps(lines: string[], ops: EditFileOpSchema[]): void {
  const applyOrder = [...ops].sort((a, b) => {
    if (a.lineNo !== b.lineNo) return b.lineNo - a.lineNo;
    const aStart = "start" in a ? a.start : 0;
    const bStart = "start" in b ? b.start : 0;
    return bStart - aStart;
  });
  for (const op of applyOrder) {
    switch (op.function) {
      case "insert": {
        applyInsert(lines, op);
        break;
      }
      case "delete": {
        const { lineNo, count } = op;
        lines.splice(lineNo - 1, count);
        break;
      }
      case "replace": {
        const { lineNo, count, text } = op;
        lines.splice(lineNo - 1, count, ...text.split("\n"));
        break;
      }
      case "edit": {
        applyEdit(lines, op);
        break;
      }
    }
  }
}

function applyInsert(lines: string[], op: Extract<EditFileOpSchema, { function: "insert" }>): void {
  const { lineNo, start, text } = op;
  const textArr = text.split("\n");
  if (lines.length + 1 === lineNo) {
    lines.push(...textArr);
    return;
  }
  const currentLine: string | undefined = lines[lineNo - 1];
  const prefix = currentLine ? currentLine.slice(0, start) : "";
  const suffix = currentLine ? currentLine.slice(start) : "";

  const m = textArr.length;
  const replacement: string[] =
    m === 1
      ? [prefix + (textArr[0] ?? "") + suffix]
      : [prefix + (textArr[0] ?? ""), ...textArr.slice(1, -1), (textArr[m - 1] ?? "") + suffix];
  lines.splice(lineNo - 1, 1, ...replacement);
}

function applyEdit(lines: string[], op: Extract<EditFileOpSchema, { function: "edit" }>): void {
  const { lineNo, start, end, text } = op;
  const textArr = text.split("\n");
  const targetLine: string | undefined = lines[lineNo - 1];
  const resolvedEnd = end === -1 ? (targetLine?.length ?? 0) : end;
  const suffix = targetLine ? targetLine.slice(resolvedEnd) : "";
  const prefix = targetLine ? targetLine.slice(0, start) : "";
  const m = textArr.length;
  const replacement: string[] =
    m === 1
      ? [prefix + (textArr[0] ?? "") + suffix]
      : [prefix + (textArr[0] ?? ""), ...textArr.slice(1, -1), (textArr[m - 1] ?? "") + suffix];
  lines.splice(lineNo - 1, 1, ...replacement);
}
