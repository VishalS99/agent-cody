import type { Agent } from "../agent.js";
import { updateSession } from "../db.js";

export function persistSession(agent: Agent): void {
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
}
