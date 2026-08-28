# DB Schema

## Session table — one row per agent session (source of truth for AgentContext)

1. session_id TEXT PK
2. model_id TEXT (e.g. openai:gpt-4o)
3. created_at INTEGER (unix ms)
4. last_updated_at INTEGER
5. goal TEXT — from set_goal contextUpdate (manager.ts:14)
6. action_steps JSON TEXT — ActionStep[] {action, status} ordered
7. task_request TEXT — latest user request, used as the in-memory compaction input
8. stats JSON TEXT — SessionStats inline (toolCalls, tokens, etc. - 1:1 with session)
9. compaction_count INTEGER
10. curr_version INTEGER
11. available_tools JSON TEXT — string[] of tool names only (e.g. ["read_file","bash_exec"], rebuild defs via discover; storing full schemas is bloated)
12. state JSON TEXT — ContextState inline {notes[], decisions[], current_step, files_read[]} — see below

## Session state — INLINED as sessions.state JSON (not a separate table)

Why JSON inline is better: 1:1 with session, always loaded together, no JOIN on every turn,
atomic transaction with sessions update (no partial state), no FK orphan/cascade, simpler migrations (1 table).
Separate table only helps if state is huge or queried independently - not here (small arrays).
If kept separate, schema would be: id PK, session_id FK UNIQUE, notes JSON, decisions JSON, current_step INTEGER, files_read JSON

## Message table — append-only transcript, including compaction boundaries

1. msg_id INTEGER PK — global order, use ORDER BY msg_id for per-session replay (gaps from other sessions are fine)
2. session_id TEXT FK -> sessions.session_id
3. created_at INTEGER
4. role TEXT — user|assistant|tool|system
5. content TEXT
6. kind TEXT DEFAULT 'message' — 'message'|'compaction_task'|'compaction_summary'
   A compaction atomically inserts a fresh user task (compaction_task) followed by its
   assistant summary (compaction_summary), matching the reset in agent.ts:263 / compact.ts:94.
7. tool_calls JSON TEXT — ChatCompletionMessageToolCall[] (request side)
8. tool_call_id TEXT — for role=tool
9. name TEXT — tool name for role=tool
Constraints: UNIQUE(session_id, msg_id), INDEX(session_id, kind, msg_id)
Rebuild: if sessions.compaction_count = 0, select all messages. Otherwise,
select from the latest compaction_task (inclusive) through the end, ordered by
msg_id. msg_id is used instead of created_at because timestamps can collide.

## Tool action table — result side of tool calls (separate from messages.tool_calls request side)

Needed for hydrateToolMessages() agent.ts:398

1. message_id INTEGER PK FK -> messages.msg_id — the associated role=tool message
2. session_id TEXT — paired with message_id in an FK to messages(session_id, msg_id)
3. tool_call_id TEXT
4. tool TEXT — tool name
5. arguments TEXT — JSON string
6. content TEXT — result JSON
7. isError INTEGER (0/1)
8. timestamp INTEGER
9. contextUpdate JSON TEXT — optional ContextUpdate
Constraints: UNIQUE(session_id, tool_call_id), INDEX(session_id, message_id)

## Persistence scope (for now)

1. Session details -> sessions table
2. Messages in sessions -> messages table
3. Tool actions -> tool_actions table
Not needed now: user table, transcript path (DB is source of truth), available_models registry (use config)
