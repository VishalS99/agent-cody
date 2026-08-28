import { buildRequestSystemPrompt } from "../prompt/prompt.js";
import type { AgentContext } from "../types.js";

export function estimateContextTokens(context: AgentContext): number {
  const system = buildRequestSystemPrompt(context);
  const transcript = context.messages
    .map(message => `${message.role}:${message.content ?? ""}${message.tool_call_id ?? ""}`)
    .join("\n");
  return Math.max(1, Math.round((system.length + transcript.length) / 4));
}
