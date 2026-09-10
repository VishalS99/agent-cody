import { config } from "../../config/env.js";
import { LLMClient } from "../../llm/client.js";
import { Agent } from "../agent.js";
import { buildAgentContextFromSessionId, initializeDatabase, insertSession, selectSession } from "../db.js";
import { buildSystemPrompt } from "../prompt/system.js";
import { createSessionStats } from "../stats.js";
import { allToolDefinitions } from "../tools/discover.js";
import { allowedRoot } from "../tools/fs_guard.js";
import type { AgentContext } from "../types.js";

export async function buildAgentContext(): Promise<AgentContext> {
  const root = await allowedRoot();

  const context: AgentContext = {
    system_prompt: buildSystemPrompt(root),
    messages: [],
    available_tools: allToolDefinitions,
    tool_actions_taken: [],
  };
  return context;
}

export async function createAgent(oldSessionId: string | undefined, isNew: boolean | undefined): Promise<Agent> {
  initializeDatabase();
  const client = new LLMClient("openai-completions", config);

  if (isNew === undefined && oldSessionId === undefined) {
    throw new Error("Session should already exist or be created new");
  }

  if (oldSessionId) {
    const session = selectSession(oldSessionId);
    if (session?.cwd) {
      try {
        process.chdir(session.cwd);
      } catch {
        // Keep the launch directory if the persisted workspace no longer exists.
      }
    }
    return restoreAgent(oldSessionId, client);
  }

  return createNewAgent(client);
}

async function restoreAgent(sessionId: string, client: LLMClient): Promise<Agent> {
  const oldSessionDetails = await buildAgentContextFromSessionId(sessionId);
  if (oldSessionDetails.error) {
    throw new Error(oldSessionDetails.error);
  }
  const context = oldSessionDetails.agentContext;
  const stats = oldSessionDetails.stats;
  const compactionCount = oldSessionDetails.compactionCount;
  if (context == null) {
    throw new Error("Old session context is null or undefined");
  }
  if (stats == null) {
    throw new Error("Old session stats is null or undefined");
  }
  if (compactionCount == null) {
    throw new Error("Old session compaction count is null or undefined");
  }
  const cwd = oldSessionDetails.cwd;
  return new Agent(client, context, stats, sessionId, compactionCount, cwd);
}

async function createNewAgent(client: LLMClient): Promise<Agent> {
  const defaultContext = await buildAgentContext();
  const cwd = await allowedRoot();
  const defaultStats = createSessionStats();
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  insertSession({
    sessionId,
    modelId: client.getModel(),
    createdAt: now,
    lastUpdatedAt: now,
    goal: null,
    actionSteps: [],
    taskRequest: "",
    stats: defaultStats,
    compactionCount: 0,
    currVersion: 1,
    availableTools: allToolDefinitions.map(tool => tool.function.name),
    state: {
      notes: [],
      decisions: [],
      current_step: 0,
      files_read: [],
    },
    cwd,
  });

  return new Agent(client, defaultContext, defaultStats, sessionId, 0, cwd);
}
