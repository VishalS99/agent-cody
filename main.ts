import { buildAgentContextFromSessionId, initializeDatabase, insertSession, updateSession } from "./agent/db.js";
import { runLoop } from "./agent/loop.js";
import { Agent } from "./agent/agent.js";
import { createSessionStats } from "./agent/stats.js";
import { LLMClient } from "./llm/client.js";
import { config } from "./config/env.js";
import type { AgentContext } from "./agent/types.js";
import { allToolDefinitions } from "./agent/tools/discover.js";
import { allowedRoot } from "./agent/tools/fs_guard.js";
import { buildSystemPrompt } from "./agent/prompt/prompt.js";
import { parseArgs } from "node:util";

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

async function init(oldSessionId: string | undefined): Promise<Agent> {
  initializeDatabase();
  const client = new LLMClient("openai-completions", config);

  if (oldSessionId) {
    const oldSessionDetails = await buildAgentContextFromSessionId(oldSessionId);
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
    return new Agent(client, context, stats, oldSessionId, compactionCount);
  }

  const defaultContext = await buildAgentContext();
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
  });

  return new Agent(client, defaultContext, defaultStats, sessionId, 0);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      sessionId: { type: "string" },
    },
    allowPositionals: true,
  });
  const sessionId = values.sessionId;
  const agent = await init(sessionId);
  await runLoop(agent);
  const context = agent.getAgentContext();
  updateSession(agent.getSessionId(), {
    lastUpdatedAt: Date.now(),
    stats: agent.getStats(),
    compactionCount: agent.getCompactionCount(),
    ...(context.goal !== undefined ? { goal: context.goal } : {}),
    ...(context.action_steps !== undefined ? { actionSteps: context.action_steps } : {}),
    ...(context.task_request !== undefined ? { taskRequest: context.task_request } : {}),
    ...(context.available_tools !== undefined
      ? { availableTools: context.available_tools.map(tool => tool.function.name) }
      : {}),
    ...(context.state !== undefined ? { state: context.state } : {}),
  });
  console.log("Session: ", agent.getSessionId());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
