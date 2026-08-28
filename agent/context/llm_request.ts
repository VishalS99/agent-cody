import type { LLMRequest } from "../../llm/types.js";
import { buildRequestSystemPrompt } from "../prompt/prompt.js";
import type { AgentContext } from "../types.js";
import { toWireTool } from "../util.js";
import { hydrateToolMessages } from "./hydrate.js";

export function toLLMRequest(context: AgentContext, isTempReq = false): LLMRequest {
  const hydratedMessages = hydrateToolMessages(context);
  const req: LLMRequest = { messages: hydratedMessages };

  if (context.system_prompt) {
    req.systemPrompt = buildRequestSystemPrompt(context);
  }

  if (isTempReq) return req;
  const availableTools = context.available_tools;
  if (availableTools && availableTools.length > 0) {
    req.tools = availableTools.map(toWireTool);
  }

  return req;
}
