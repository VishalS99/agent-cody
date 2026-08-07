import type { ChatCompletionTool } from "openai/resources"
import type { ToolDefinition } from "./types.js"
import * as z from "zod"

export function toWireTool<T extends z.ZodType>(
  t: ToolDefinition<T>,
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: z.toJSONSchema(t.function.parameters, { io: "input" }),
    },
  }
}
