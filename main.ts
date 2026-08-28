import { buildAgentContextFromSessionId, initializeDatabase, insertSession } from "./agent/db.js";
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
    if (context == null) {
      throw new Error("Old session context is null or undefined");
    }
    if (stats == null) {
      throw new Error("Old session stats is null or undefined");
    }
    return new Agent(client, context, stats, oldSessionId);
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

  return new Agent(client, defaultContext, defaultStats, sessionId);
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
  console.log("Session: ", agent.getSessionId());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
