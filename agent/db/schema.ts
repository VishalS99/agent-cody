import { db } from "./connection.js";

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
