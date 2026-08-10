/**
 * edit_file — batched, atomic, in-place edits to an existing text file.
 *
 * Ops (each carries only its own fields):
 *   edit:   { lineNo, start, end, text } — replace [start,end) columns with text; empty text deletes the span (partial-line delete)
 *   insert: { lineNo, start, text }      — insert text at column start (text may contain "\n")
 *   delete: { lineNo, count = 1 }        — remove `count` whole lines (complete-line deletes only)
 *
 * Indexing: lineNo 1-indexed, start/end UTF-16 code units — matches read_file (no phantom
 * trailing line; "\r\n" stripped). All ops target ORIGINAL-file coordinates.
 *
 * Contract: validate everything before mutating; write-back via temp file + rename (atomic);
 * on any failure the file is untouched and isError:true. Ops apply sorted by (lineNo desc,
 * start desc). Overlapping/ambiguous ops (same-line ranges, same-point inserts, delete vs an
 * op in its range) are rejected. Only text files: binaries, dirs, >1MB rejected.
 *
 * Response: success/op-failure -> { path, edits: [{ index, function, error? }] } (input order,
 * error only on the single failing op); file-level failure -> { path, error }.
 */
import * as z from "zod"
import type { ToolDefinition, ToolResult } from "../types.js"
import * as nodePath from "node:path"
import * as fsProm from "node:fs/promises"

export const editFileOpSchema = z.discriminatedUnion("function", [
  z.object({
    function: z.literal("edit").describe("Op kind: edit — replaces a column range on one line"),
    lineNo: z.number().int().min(1).describe("1-indexed line number to edit"),
    start: z
      .number()
      .int()
      .min(0)
      .describe("Start column (0-based, inclusive), UTF-16 code units"),
    end: z
      .number()
      .int()
      .min(0)
      .describe("End column (0-based, EXCLUSIVE); the [start,end) span is replaced — end = line length replaces the rest of the line"),
    text: z
      .string()
      .describe("Replacement text; may contain newlines to expand into multiple lines; use the 'delete' op for whole-line removal, or empty text (\"\") to delete just the [start,end) span"),
  }),
  z.object({
    function: z.literal("insert").describe("Op kind: insert — inserts text at a column on one line"),
    lineNo: z
      .number()
      .int()
      .min(1)
      .describe("1-indexed line number; lines.length+1 appends at end of file"),
    start: z
      .number()
      .int()
      .min(0)
      .describe("Column (0-based, inclusive), UTF-16 code units; must be 0 for end-of-file insert"),
    text: z
      .string()
      .describe("Text to insert; may contain newlines to add multiple lines"),
  }),
  z.object({
    function: z.literal("delete").describe("Op kind: delete — removes whole lines"),
    lineNo: z.number().int().min(1).describe("1-indexed first line to delete"),
    count: z.number().int().min(1).default(1).describe("Number of lines to delete (default 1)"),
  }),
])

export const editFileSchema = z.object({
  path: z
    .string()
    .readonly()
    .describe("Path to the file to edit (relative paths resolve against cwd); file must exist"),
  ops: z
    .array(editFileOpSchema)
    .describe("Edit ops, applied atomically as one batch — all validated before any mutation"),
})

export const editFileResultSchema = z.object({
  path: z.string().readonly().describe("Absolute path of the edited file"),
  edits: z
    .array(
      z.object({
        index: z.number().int().min(0).describe("0-based index into the input ops array (correlation key)"),
        function: z.enum(["edit", "insert", "delete"]).describe("Echo of the op kind"),
        error: z.string().optional().describe("Present only on the single op that failed; the failure reason"),
      }),
    )
    .describe("Per-op result echo, in input order"),
})

export type EditFileSchema = z.infer<typeof editFileSchema>
export type EditFileOpSchema = z.infer<typeof editFileOpSchema>

export type EditFileResultSchema = z.infer<typeof editFileResultSchema>
interface OpsFailure {
  index: number
  function: "edit" | "insert" | "delete"
  error: string
}

const MAX_OPS = 200

export const editFileToolDefinition: ToolDefinition<typeof editFileSchema> = {
  type: "function",
  function: {
    name: "edit_file",
    description: `Apply a batched sequence of atomic edits (edit/insert/delete) to an existing text file. All ops are validated
    before any mutation — on any failure the file is untouched. 'delete' removes whole lines — use it for ANY complete-line change
    (complete line deletes are ONLY via 'delete'). 'edit' replaces ONLY the [start,end) column span (end EXCLUSIVE): e.g. "abc def"
    with edit {lineNo:1, start:0, end:3, text:"XY"} yields "XY def"; start:0, end:<line length> replaces the whole line; empty
    text (text:"") deletes just the span (partial-line deletes). 'insert' adds text at a column (may contain newlines).
    Coordinates are 1-indexed line numbers and UTF-16 code-unit column offsets (matching read_file). Only text files supported;
    binaries and oversized files are rejected.`,
    label: "Edit File",
    parameters: editFileSchema,
    /** Validate -> apply -> atomic write-back: file check, read, op/inter-op validation, sorted apply, temp-file rename. */
    execute: async (toolId, params: EditFileSchema): Promise<ToolResult> => {
      const { path, ops } = params

      if (ops.length === 0) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: nodePath.resolve(path), edits: [] }),
          isError: false,
        }
      }
      if (ops.length > MAX_OPS) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({
            path: nodePath.resolve(path),
            error: `too many ops (${ops.length}); max ${MAX_OPS}`,
          }),
          isError: true,
        }
      }

      // file level validation
      const resolvedPath = nodePath.resolve(path)
      const { isErr, error } = await editFileValidation(resolvedPath)
      if (isErr) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: resolvedPath, error }),
          isError: true,
        }
      }

      // file read
      const fileContent = await fsProm.readFile(resolvedPath, {
        encoding: "utf8",
      })
      let lines: string[] = fileContent.split("\n")
      const hadTrailingNewline = fileContent.endsWith("\n")
      if (lines[lines.length - 1] === "") lines.pop()
      lines = lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))

      // ops validation
      let opsValFailure: OpsFailure| null = null;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!
        opsValFailure = validateOps(op, i, lines)
        if (opsValFailure) break
      }

      if (opsValFailure) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: resolvedPath, edits: [opsValFailure] }),
          isError: true,
        }
      }

      // inter op validation
      opsValFailure = validateInterOps(ops)
      if (opsValFailure) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ path: resolvedPath, edits: [opsValFailure] }),
          isError: true,
        }
      }

      // all validations done, perform the ops
      const applyOrder = [...ops].sort((a, b) => {
        if (a.lineNo !== b.lineNo) return b.lineNo - a.lineNo
        const aStart = "start" in a ? a.start : 0
        const bStart = "start" in b ? b.start : 0
        return bStart - aStart
      })
      for (const op of applyOrder) {
        switch (op.function) {
          case "insert": {
            const { lineNo, start, text } = op
            const textArr = text.split("\n")
            if (lines.length + 1 === lineNo) {
              lines.push(...textArr)
              break
            }
            const currentLine: string | undefined = lines[lineNo - 1]
            const prefix = currentLine ? currentLine.slice(0, start) : ""
            const suffix = currentLine ? currentLine.slice(start) : ""

            const m = textArr.length
            const replacement: string[] = m === 1
              ? [prefix + textArr[0]! + suffix]
              : [prefix + textArr[0]!, ...textArr.slice(1, -1), textArr[m - 1]! + suffix]
            lines.splice(lineNo - 1, 1, ...replacement)
            break
          }
          case "delete": {
            const { lineNo, count } = op
            lines.splice(lineNo - 1, count)
            break
          }
          case "edit": {
            const { lineNo, start, end, text } = op
            const textArr = text.split("\n")
            const targetLine: string | undefined = lines[lineNo - 1]
            const suffix = targetLine ? targetLine.slice(end) : ""
            const prefix = targetLine ? targetLine.slice(0, start) : ""
            const m = textArr.length
            const replacement: string[] = m === 1
              ? [prefix + textArr[0]! + suffix]
              : [prefix + textArr[0]!, ...textArr.slice(1, -1), textArr[m - 1]! + suffix]
            lines.splice(lineNo - 1, 1, ...replacement)
            break
          }
        }
      }
      // atomic write-back
      const tmpPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`

      try {
        const out = lines.join("\n") + (hadTrailingNewline ? "\n" : "")
        const handle = await fsProm.open(tmpPath, "w")
        try {
          await handle.writeFile(out, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }

        await fsProm.rename(tmpPath, resolvedPath)
      } catch (err) {
        await fsProm.unlink(tmpPath).catch(() => {}) // Clean up temp file
        throw err
      }

      return {
        tool_call_id: toolId,
        content: JSON.stringify({
          path: resolvedPath,
          edits: ops.map((op, index) => ({ index, function: op.function })),
        }),
        isError: false,
      }
    },
  },
}

/**
 * Rejects overlapping ops: delete vs any op in its range, same-line range overlaps,
 * and duplicate same-point inserts.
 */
function validateInterOps(ops: EditFileOpSchema[]): OpsFailure | null {
  let opsValFailure: OpsFailure | null = null
  for (let i = 0; i < ops.length && !opsValFailure; i++) {
    const opsA = ops[i]!
    for (let j = i + 1; j < ops.length; j++) {
      const opsB = ops[j]!
      if (opsA.function === "delete" && opsB.lineNo >= opsA.lineNo && opsB.lineNo <= opsA.lineNo + opsA.count - 1){
        opsValFailure = { index: j, function: opsB.function, error: `op ${j} (${opsB.function} on line ${opsB.lineNo}) conflicts with op ${i} (delete of lines ${opsA.lineNo}-${opsA.lineNo + opsA.count - 1}) — move one op to a different line` }
        break
      }
      if (opsB.function === "delete" && opsA.lineNo >= opsB.lineNo && opsA.lineNo <= opsB.lineNo + opsB.count - 1) {
        opsValFailure = { index: i, function: opsA.function, error: `op ${i} (${opsA.function} on line ${opsA.lineNo}) conflicts with op ${j} (delete of lines ${opsB.lineNo}-${opsB.lineNo + opsB.count - 1}) — move one op to a different line` }
        break
      }
      if (opsA.function === "edit" && opsB.function === "edit" && opsA.lineNo === opsB.lineNo && opsA.start < opsB.end && opsB.start < opsA.end) {
        opsValFailure = { index: i, function: "edit", error: `op ${i} edit [${opsA.start}, ${opsA.end}) overlaps op ${j} edit [${opsB.start}, ${opsB.end}) on line ${opsA.lineNo} — adjust one range` }
        break
      }
      if (opsA.function === "edit" && opsB.function === "insert" && opsA.lineNo === opsB.lineNo && opsA.start <= opsB.start && opsB.start < opsA.end) {
        opsValFailure = { index: i, function: "edit", error: `op ${j} insert at col ${opsB.start} lands inside op ${i} edit [${opsA.start}, ${opsA.end}) on line ${opsA.lineNo} — move the insert or shrink the edit range` }
        break
      }
      if (opsA.function === "insert" && opsB.function === "edit" && opsA.lineNo === opsB.lineNo && opsB.start <= opsA.start && opsA.start < opsB.end) {
        opsValFailure = { index: i, function: "insert", error: `op ${i} insert at col ${opsA.start} lands inside op ${j} edit [${opsB.start}, ${opsB.end}) on line ${opsA.lineNo} — move the insert or shrink the edit range` }
        break
      }
      if (opsA.function === "insert" && opsB.function === "insert" && opsA.lineNo === opsB.lineNo && opsA.start === opsB.start) {
        opsValFailure = { index: i, function: "insert", error: `op ${i} and op ${j} both insert at (line ${opsA.lineNo}, col ${opsA.start}) — ambiguous order; merge into one insert with "\\n"-joined text` }
        break
      }
    }
  }
  return opsValFailure
}

/** Validates one op against the original lines: bounds, ordering, and surrogate-boundary checks. */
function validateOps(op: EditFileOpSchema, opIndx: number, lines: string[]): OpsFailure | null {
  let failure: OpsFailure = { index: opIndx, function: op.function, error: "" }
  switch (op.function) {
    case "edit": {
      const { lineNo, start, end } = op
      if (lineNo > lines.length) {
        failure = {
          index: opIndx,
          function: "edit",
          error: `line ${lineNo} out of range (file has ${lines.length} lines)`,
        }
        break
      }
      const targetLine = lines[lineNo - 1]!
      if (start > targetLine.length) {
        failure.error = `start ${start} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`
        break
      }
      if (end > targetLine.length) {
        failure.error = `end ${end} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`
        break
      }
      if (start > end) {
        failure.error = `start ${start} must be less than or equal to end ${end}`
        break
      }
      if (isLowSurrogate(targetLine, start)) {
        failure.error = `start ${start} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`
        break
      }
      if (isLowSurrogate(targetLine, end)) {
        failure.error = `end ${end} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`
        break
      }
      break
    }
    case "insert": {
      const { lineNo, start } = op
      if (lineNo > lines.length + 1) {
        failure.error = `line ${lineNo} out of range (file has ${lines.length} lines)`
        break
      }
      if (lineNo === lines.length + 1) {
        // EOF append — no host line to splice into; start must be 0
        if (start !== 0) {
          failure.error = `start ${start} invalid for end-of-file insert (lineNo ${lineNo}); start must be 0`
        }
        break
      }
      const targetLine = lines[lineNo - 1]!
      if (start > targetLine.length) {
        failure.error = `start ${start} out of range for line ${lineNo} (length ${targetLine.length}): "${linePreview(targetLine)}"`
        break
      }
      if (isLowSurrogate(targetLine, start)) {
        failure.error = `start ${start} on line ${lineNo} splits a surrogate pair (emoji); move left or right by 1`
        break
      }
      break
    }
    case "delete": {
      const { lineNo, count } = op
      if (lineNo > lines.length) {
        failure.error = `line ${lineNo} out of range (file has ${lines.length} lines)`
        break
      }
      if (lineNo + count - 1 > lines.length) {
        failure.error = `delete range [${lineNo}, ${lineNo + count - 1}] exceeds file length (${lines.length} lines)`
        break
      }
      break
    }
  }
  return failure.error ? failure : null;
}

/** True if col lands on the trailing half of a surrogate pair, i.e. a cut would split an emoji. */
function isLowSurrogate(line: string, col: number): boolean {
  // a cut splits an emoji pair iff col lands on the trailing (low) surrogate; a high surrogate is a valid boundary
  const code = line.charCodeAt(col) // 16-bit code unit at that slot
  return code >= 0xdc00 && code <= 0xdfff
}


const MAX_BYTES = 1_000_000
const BINARY_SNIFF_BYTES = 1024

/** Rejects directories, oversized files, and binaries (NUL sniff); reports access errors. */
async function editFileValidation(
  filePath: string,
): Promise<{ isErr: boolean; error: string }> {
  let fd: fsProm.FileHandle | undefined

  try {
    fd = await fsProm.open(filePath, "r")
    const stats = await fd.stat()

    if (stats.isDirectory()) {
      return { isErr: true, error: `Path is a directory: ${filePath}` }
    }

    if (stats.size > MAX_BYTES) {
      return { isErr: true, error: `File is too large (${stats.size} bytes)` }
    }
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES)
    const { bytesRead } = await fd.read(buf, 0, BINARY_SNIFF_BYTES, 0)
    const sniff = buf.subarray(0, bytesRead)

    if (sniff.includes(0)) {
      return { isErr: true, error: `File is binary: ${filePath}` }
    }
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return { isErr: true, error: `File not found: ${filePath}` }
    }
    return { isErr: true, error: `Failed to access file (${e.code || e.message}): ${filePath}` }
  } finally {
    await fd?.close()
  }

  return { isErr: false, error: "" }
}
