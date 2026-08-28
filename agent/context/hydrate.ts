import type { Messages } from "../../schemas/messages.js";
import type { AgentContext } from "../types.js";

export function hydrateToolMessages(context: AgentContext): Messages[] {
  const toolMap = new Map((context.tool_actions_taken ?? []).map(action => [action.tool_call_id, action]));

  return context.messages.map(msg => {
    if (msg.role !== "tool") {
      return msg;
    }

    const tool = toolMap.get(msg.tool_call_id ?? "");
    if (!tool) {
      throw new Error(`Missing stored tool action for call ${msg.tool_call_id ?? "(unknown)"}`);
    }

    return { ...msg, content: tool.content };
  });
}
