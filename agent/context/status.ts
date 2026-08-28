import type { AgentContext } from "../types.js";

export function isTaskIncomplete(context: AgentContext): boolean {
  return (context.action_steps ?? []).some(step => step.status !== "completed");
}
