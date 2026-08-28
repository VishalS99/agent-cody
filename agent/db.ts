import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { Messages } from "../schemas/messages.js";
import type { ActionStep, AgentContext, ContextState, ToolAction } from "./types.js";
import { createSessionStats } from "./stats.js";
import type { SessionStats } from "./stats.js";
import { logger } from "../config/logger.js";
import { allowedRoot } from "./tools/fs_guard.js";
import { buildSystemPrompt } from "./prompt/prompt.js";
import { getToolDefinitionByName } from "./tools/discover.js";

export const db = new Database("cody_db.sqlite");

export function initializeDatabase(): void {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_updated_at INTEGER NOT NULL,
      goal TEXT,
      action_steps TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(action_steps)),
      task_request TEXT NOT NULL DEFAULT '',
      stats TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(stats)),
      compaction_count INTEGER NOT NULL DEFAULT 0 CHECK (compaction_count >= 0),
      curr_version INTEGER NOT NULL DEFAULT 1,
      available_tools TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(available_tools)),
      state TEXT NOT NULL DEFAULT '{"notes":[],"decisions":[],"current_step":0,"files_read":[]}' CHECK (json_valid(state))
    );

    CREATE TABLE IF NOT EXISTS messages (
      msg_id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
      content TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'compaction_task', 'compaction_summary')),
      tool_calls TEXT CHECK (tool_calls IS NULL OR json_valid(tool_calls)),
      tool_call_id TEXT,
      name TEXT,
      UNIQUE (session_id, msg_id)
    );

    CREATE INDEX IF NOT EXISTS messages_session_kind_msg_id_idx
      ON messages (session_id, kind, msg_id);

    CREATE TABLE IF NOT EXISTS tool_actions (
      message_id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      arguments TEXT NOT NULL CHECK (json_valid(arguments)),
      content TEXT NOT NULL,
      is_error INTEGER NOT NULL CHECK (is_error IN (0, 1)),
      timestamp INTEGER NOT NULL,
      context_update TEXT CHECK (context_update IS NULL OR json_valid(context_update)),
      UNIQUE (session_id, tool_call_id),
      FOREIGN KEY (session_id)
        REFERENCES sessions (session_id) ON DELETE CASCADE,
      FOREIGN KEY (session_id, message_id)
        REFERENCES messages (session_id, msg_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS tool_actions_session_message_id_idx
      ON tool_actions (session_id, message_id);
  `);
}

export interface SessionRecord {
  sessionId: string;
  modelId: string;
  createdAt: number;
  lastUpdatedAt: number;
  goal: string | null;
  actionSteps: ActionStep[];
  taskRequest: string;
  stats: SessionStats;
  compactionCount: number;
  currVersion: number;
  availableTools: string[];
  state: ContextState;
}

export interface MessageRecord extends Messages {
  msgId: number;
  sessionId: string;
  createdAt: number;
  kind: "message" | "compaction_task" | "compaction_summary";
}

export interface ToolActionRecord extends ToolAction {
  messageId: number;
  sessionId: string;
}

export interface AgentContextFromSessionId {
  agentContext: AgentContext | null;
  stats: SessionStats | null;
  compactionCount: number | null;
  error: string;
}

type SessionUpdate = Partial<Omit<SessionRecord, "sessionId" | "createdAt" | "modelId">>;

export function insertSession(session: SessionRecord): void {
  db.prepare(
    `INSERT INTO sessions (
      session_id, model_id, created_at, last_updated_at, goal, action_steps,
      task_request, stats, compaction_count, curr_version, available_tools, state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.sessionId,
    session.modelId,
    session.createdAt,
    session.lastUpdatedAt,
    session.goal,
    JSON.stringify(session.actionSteps),
    session.taskRequest,
    JSON.stringify(session.stats),
    session.compactionCount,
    session.currVersion,
    JSON.stringify(session.availableTools),
    JSON.stringify(session.state),
  );
}

export function selectSession(sessionId: string): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT session_id, model_id, created_at, last_updated_at, goal, action_steps,
              task_request, stats, compaction_count, curr_version, available_tools, state
       FROM sessions WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | null;

  if (!row) return null;
  return {
    sessionId: row.session_id as string,
    modelId: row.model_id as string,
    createdAt: row.created_at as number,
    lastUpdatedAt: row.last_updated_at as number,
    goal: row.goal as string | null,
    actionSteps: JSON.parse(row.action_steps as string) as ActionStep[],
    taskRequest: row.task_request as string,
    stats: JSON.parse(row.stats as string) as SessionStats,
    compactionCount: row.compaction_count as number,
    currVersion: row.curr_version as number,
    availableTools: JSON.parse(row.available_tools as string) as string[],
    state: JSON.parse(row.state as string) as ContextState,
  };
}

export function updateSession(sessionId: string, updates: SessionUpdate): void {
  const columns: Record<string, unknown> = {
    last_updated_at: updates.lastUpdatedAt,
    goal: updates.goal,
    action_steps: updates.actionSteps === undefined ? undefined : JSON.stringify(updates.actionSteps),
    task_request: updates.taskRequest,
    stats: updates.stats === undefined ? undefined : JSON.stringify(updates.stats),
    compaction_count: updates.compactionCount,
    curr_version: updates.currVersion,
    available_tools: updates.availableTools === undefined ? undefined : JSON.stringify(updates.availableTools),
    state: updates.state === undefined ? undefined : JSON.stringify(updates.state),
  };
  const entries = Object.entries(columns).filter((entry): entry is [string, unknown] => entry[1] !== undefined);
  if (entries.length === 0) return;

  const values = entries.map(([, value]) => value as SQLQueryBindings);
  db.prepare(`UPDATE sessions SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE session_id = ?`).run(
    ...values,
    sessionId,
  );
}

export function deleteSession(sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
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

export async function buildAgentContextFromSessionId(sessionId: string): Promise<AgentContextFromSessionId> {
  if (sessionId.trim() === "") {
    return {
      agentContext: null,
      stats: null,
      compactionCount: null,
      error: "Error: sessionId is empty",
    };
  }

  const root: string = await allowedRoot();

  const agc: AgentContext = {
    system_prompt: buildSystemPrompt(root),
    messages: [],
  };
  const sess: SessionRecord | null = selectSession(sessionId);

  if (sess == null) {
    return {
      agentContext: null,
      stats: null,
      compactionCount: null,
      error: "Error: session not found",
    };
  }

  if (sess.actionSteps) agc.action_steps = sess.actionSteps;
  if (sess.goal) agc.goal = sess.goal;
  if (sess.taskRequest) agc.task_request = sess.taskRequest;

  const stats: SessionStats = sess.stats ?? createSessionStats();
  if (sess.availableTools) {
    agc.available_tools = [];
    sess.availableTools.forEach(toolName => {
      try {
        agc.available_tools?.push(getToolDefinitionByName(toolName));
      } catch (error) {
        logger.warn(
          {
            event: "tool_definition_restore_failed",
            tool: toolName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Unable to restore persisted tool definition",
        );
      }
    });
  }
  if (sess.state) agc.state = sess.state;

  let messageRecords: MessageRecord[];
  if (sess.compactionCount === 0) {
    messageRecords = selectMessages(sessionId);
  } else {
    messageRecords = selectMessagesByLastCompaction(sessionId);
  }
  agc.messages = messageRecords.map(toMessage);

  const activeToolCallIds = new Set(
    agc.messages.filter(message => message.role === "tool").map(message => message.tool_call_id),
  );
  agc.tool_actions_taken = selectToolActions(sessionId).filter(action => activeToolCallIds.has(action.tool_call_id));

  return {
    agentContext: agc,
    stats: stats,
    compactionCount: sess.compactionCount,
    error: "",
  };
}

function toMessage(record: MessageRecord): Messages {
  return {
    role: record.role,
    content: record.content,
    ...(record.tool_call_id ? { tool_call_id: record.tool_call_id } : {}),
    ...(record.tool_calls ? { tool_calls: record.tool_calls } : {}),
    ...(record.name ? { name: record.name } : {}),
  };
}

/**
 * Session table - one row per agent session (source of truth for AgentContext)
 * 1. session_id TEXT PK
 * 2. model_id TEXT (e.g. openai:gpt-4o)
 * 3. created_at INTEGER (unix ms)
 * 4. last_updated_at INTEGER
 * 5. goal TEXT - from set_goal contextUpdate (manager.ts:14)
 * 6. action_steps JSON TEXT - ActionStep[] {action, status} ordered
 * 7. task_request TEXT - latest user request, used as the in-memory compaction input
 * 8. stats JSON TEXT - SessionStats inline (toolCalls, tokens, etc. - 1:1 with session)
 * 9. compaction_count INTEGER
 * 10. curr_version INTEGER
 * 11. available_tools JSON TEXT - string[] of tool names only (e.g. ["read_file","bash_exec"], rebuild defs via loop.ts:43; storing full schemas is bloated)
 * 12. state JSON TEXT - ContextState inline {notes[], decisions[], current_step, files_read[]} - see below
 */

/**
 * Session state - INLINED as sessions.state JSON (not a separate table)
 * Why JSON inline is better: 1:1 with session, always loaded together, no JOIN on every turn,
 * atomic transaction with sessions update (no partial state), no FK orphan/cascade, simpler migrations (1 table).
 * Separate table only helps if state is huge or queried independently - not here (small arrays).
 * If kept separate, schema would be: id PK, session_id FK UNIQUE, notes JSON, decisions JSON, current_step INTEGER, files_read JSON
 */

/**
 * Message table - append-only transcript, including compaction boundaries
 * 1. msg_id INTEGER PK - global order, use ORDER BY msg_id for per-session replay (gaps from other sessions are fine)
 * 2. session_id TEXT FK -> sessions.session_id
 * 3. created_at INTEGER
 * 4. role TEXT - user|assistant|tool|system
 * 5. content TEXT
 * 6. kind TEXT DEFAULT 'message' - 'message'|'compaction_task'|'compaction_summary'
 *    A compaction atomically inserts a fresh user task (compaction_task) followed by its
 *    assistant summary (compaction_summary), matching the reset in agent.ts:263 / compact.ts:94.
 * 7. tool_calls JSON TEXT - ChatCompletionMessageToolCall[] (request side)
 * 8. tool_call_id TEXT - for role=tool
 * 9. name TEXT - tool name for role=tool
 * Constraints: UNIQUE(session_id, msg_id), INDEX(session_id, kind, msg_id)
 * Rebuild: if sessions.compaction_count = 0, select all messages. Otherwise,
 * select from the latest compaction_task (inclusive) through the end, ordered by
 * msg_id. msg_id is used instead of created_at because timestamps can collide.
 */

/**
 * Tool action table - result side of tool calls (separate from messages.tool_calls request side)
 * Needed for hydrateToolMessages() agent.ts:398
 * 1. message_id INTEGER PK FK -> messages.msg_id - the associated role=tool message
 * 2. session_id TEXT - paired with message_id in an FK to messages(session_id, msg_id)
 * 3. tool_call_id TEXT
 * 4. tool TEXT - tool name
 * 5. arguments TEXT - JSON string
 * 6. content TEXT - result JSON
 * 7. isError INTEGER (0/1)
 * 8. timestamp INTEGER
 * 9. contextUpdate JSON TEXT - optional ContextUpdate
 * Constraints: UNIQUE(session_id, tool_call_id), INDEX(session_id, message_id)
 */

/**
 * Persistence scope (for now):
 * 1. Session details -> sessions table
 * 2. Messages in sessions -> messages table
 * 3. Tool actions -> tool_actions table
 * Not needed now: user table, transcript path (DB is source of truth), available_models registry (use config)
 */
