import type { Messages } from "../../schemas/messages.js";
import { db } from "./connection.js";

export interface MessageRecord extends Messages {
  msgId: number;
  sessionId: string;
  createdAt: number;
  kind: "message" | "compaction_task" | "compaction_summary";
}

export function insertMessage(message: Omit<MessageRecord, "msgId">): number {
  const result = db
    .prepare(
      `INSERT INTO messages (
        session_id, created_at, role, content, kind, tool_calls, tool_call_id, name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.sessionId,
      message.createdAt,
      message.role,
      message.content,
      message.kind,
      message.tool_calls === undefined ? null : JSON.stringify(message.tool_calls),
      message.tool_call_id ?? null,
      message.name ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function selectMessages(sessionId: string): MessageRecord[] {
  const rows = db
    .prepare(
      `SELECT msg_id, session_id, created_at, role, content, kind, tool_calls, tool_call_id, name
       FROM messages WHERE session_id = ? ORDER BY msg_id`,
    )
    .all(sessionId) as Record<string, unknown>[];

  return rows.map(row => ({
    msgId: row.msg_id as number,
    sessionId: row.session_id as string,
    createdAt: row.created_at as number,
    role: row.role as MessageRecord["role"],
    content: row.content as string,
    kind: row.kind as MessageRecord["kind"],
    ...(row.tool_calls === null ? {} : { tool_calls: JSON.parse(row.tool_calls as string) }),
    ...(row.tool_call_id === null ? {} : { tool_call_id: row.tool_call_id as string }),
    ...(row.name === null ? {} : { name: row.name as string }),
  }));
}

export function selectMessagesByLastCompaction(sessionId: string): MessageRecord[] {
  const rows = db
    .prepare(
      `SELECT msg_id, session_id, created_at, role, content, kind, tool_calls, tool_call_id, name
       FROM messages
       WHERE session_id = ?
         AND msg_id >= (
           SELECT msg_id
           FROM messages
           WHERE session_id = ? AND kind = 'compaction_task'
           ORDER BY msg_id DESC
           LIMIT 1
         )
       ORDER BY msg_id`,
    )
    .all(sessionId, sessionId) as Record<string, unknown>[];

  return rows.map(row => ({
    msgId: row.msg_id as number,
    sessionId: row.session_id as string,
    createdAt: row.created_at as number,
    role: row.role as MessageRecord["role"],
    content: row.content as string,
    kind: row.kind as MessageRecord["kind"],
    ...(row.tool_calls === null ? {} : { tool_calls: JSON.parse(row.tool_calls as string) }),
    ...(row.tool_call_id === null ? {} : { tool_call_id: row.tool_call_id as string }),
    ...(row.name === null ? {} : { name: row.name as string }),
  }));
}

// These deletes are for session cleanup or retention policies, not compaction.
export function deleteMessages(sessionId: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}
