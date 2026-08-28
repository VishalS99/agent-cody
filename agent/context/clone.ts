import type { AgentContext } from "../types.js";

export function buildLeanContext(context: AgentContext): AgentContext {
  return {
    ...context,
    messages: context.messages.map(message => ({
      ...message,
      ...(message.tool_calls ? { tool_calls: [...message.tool_calls] } : {}),
    })),
    ...(context.state
      ? {
          state: {
            ...context.state,
            notes: [...context.state.notes],
            decisions: [...context.state.decisions],
            files_read: [...context.state.files_read],
          },
        }
      : {}),
  };
}
