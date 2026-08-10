# Edit File Tool

> This mock file was created and edited by the edit tool of agent Cody Banks.

## Summary

The `edit_file` tool applies a batched sequence of atomic edits (edit/insert/delete) to an existing text file. All operations are validated before any mutation occurs — if any op fails validation, the file remains untouched (atomicity).

### Operation Types

- **edit**: Replaces only the `[start, end)` column span on a single line. Coordinates are 1-indexed line numbers and UTF-16 code-unit column offsets (matching `read_file`). An empty `text` value deletes just the span (partial-line delete). Example: replacing `"abc def"` with `start:0, end:3, text:"XY"` yields `"XY def"`.

- **insert**: Inserts text at a given column position on a line. The text may contain newlines to expand into multiple lines.

- **delete**: Removes whole lines. For any complete-line change, the `delete` op must be used (complete line deletes are ONLY via 'delete').

### Parameter Requirements per Function

| Function | Required Parameters | Description |
|----------|---------------------|-------------|
| `edit` | `lineNo`, `start`, `end`, `text` | 1-indexed line number, start/end column (UTF-16, end exclusive), replacement text. Empty `text` deletes the span. |
| `insert` | `lineNo`, `start`, `text` | 1-indexed line number, column offset to insert at, text (may contain newlines). |
| `delete` | `lineNo`, `count` (optional, default: 1) | 1-indexed line number of first line to delete; `count` specifies how many consecutive lines to remove. |

### Validation & Safety

- **File checks**: Rejects directories, non-text files (binary detection via NUL-byte sniffing), and oversized files (>1MB).

- **Op/inter-op validation**: Validates each op within its range and checks for overlaps or conflicts between ops. For example, an `edit` range cannot overlap another `edit` range on the same line, and inserts cannot land inside an edit range.

- **Atomic write-back**: After validation, ops are applied in sorted order and the file is written back atomically (using a temp-file + rename strategy).

### Response Format

On success: `{ path, edits: [{ index, function }] }` where `index` is the 0-based index into the input ops array (a correlation key).

On single op failure: `{ path, edits: [{ index, function, error? }] }` — only the failing op carries an `error` field with the failure reason.

On file-level failure: `{ path, error }` — the file is not modified.

### Limits

Maximum of 200 operations per call.
