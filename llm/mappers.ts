import type { ChatCompletionMessageParam } from "openai/resources.js";
import type { Messages } from "../schemas/messages.js";

export function toChatMessage(msg: Messages): ChatCompletionMessageParam {
  switch (msg.role) {
    case "system":
      return { role: "system", content: msg.content };
    case "user":
      return { role: "user", content: msg.content };
    case "assistant":
      return msg.tool_calls && msg.tool_calls.length > 0
        ? {
            role: "assistant",
            content: msg.content,
            tool_calls: msg.tool_calls,
          }
        : { role: "assistant", content: msg.content };
    case "tool":
      if (!msg.tool_call_id) {
        throw new Error("tool role messages require tool_call_id");
      }
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.tool_call_id,
      };
  }
}
