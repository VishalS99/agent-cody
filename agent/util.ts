import type { ChatCompletionTool } from "openai/resources";
import type { ToolDefinition } from "./types.js";
import * as z from "zod";

export function toWireTool<T extends z.ZodType>(t: ToolDefinition<T>): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: z.toJSONSchema(t.function.parameters, { io: "input" }),
    },
  };
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
