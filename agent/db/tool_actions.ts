import type { ToolAction } from "../types.js";
import { db } from "./connection.js";
import type { MessageRecord } from "./messages.js";
import { insertMessage } from "./messages.js";

export interface ToolActionRecord extends ToolAction {
  messageId: number;
  sessionId: string;
}

export function insertToolAction(action: ToolActionRecord): void {
  db.prepare(
    `INSERT INTO tool_actions (
      message_id, session_id, tool_call_id, tool, arguments, content,
      is_error, timestamp, context_update
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    action.messageId,
    action.sessionId,
    action.tool_call_id,
    action.tool,
    action.arguments,
    action.content,
    action.isError ? 1 : 0,
    action.timestamp,
    action.contextUpdate === undefined ? null : JSON.stringify(action.contextUpdate),
  );
}

export function insertToolMessageAndAction(
  message: Omit<MessageRecord, "msgId">,
  action: Omit<ToolActionRecord, "messageId">,
): number {
  return db.transaction(() => {
    if (message.sessionId !== action.sessionId) {
      throw new Error("Message and tool should belong to the same session");
    }
    const messageId = insertMessage(message);
    insertToolAction({ ...action, messageId });
    return messageId;
  })();
}

export function selectToolActions(sessionId: string): ToolActionRecord[] {
  const rows = db
    .prepare(
      `SELECT message_id, session_id, tool_call_id, tool, arguments, content,
              is_error, timestamp, context_update
       FROM tool_actions WHERE session_id = ? ORDER BY message_id`,
    )
    .all(sessionId) as Record<string, unknown>[];

  return rows.map(row => ({
    messageId: row.message_id as number,
    sessionId: row.session_id as string,
    tool_call_id: row.tool_call_id as string,
    tool: row.tool as string,
    arguments: row.arguments as string,
    content: row.content as string,
    isError: row.is_error === 1,
    timestamp: row.timestamp as number,
    ...(row.context_update === null ? {} : { contextUpdate: JSON.parse(row.context_update as string) }),
  }));
}
