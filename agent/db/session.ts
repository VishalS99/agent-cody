import type { SQLQueryBindings } from "bun:sqlite";
import type { ActionStep, ContextState } from "../types.js";
import type { SessionStats } from "../stats.js";
import { db } from "./connection.js";

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
