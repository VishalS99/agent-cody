import type { Messages } from "../schemas/messages.js"
import type * as z from "zod"
// Agent orchestration layer: owns the tool-call/tool-definition types and
// the conversation context. Imports direction-only from schemas/.

export interface AgentContext {
  system_prompt: string
  messages: Messages[]
  available_tools?: ToolDefinition<z.ZodType>[]
}

export interface ToolResult {
  tool_call_id: string
  content: string
  isError?: boolean
}

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  type: "function"
  function: {
    name: string
    description: string
    label: string
    parameters: TSchema
    execute(toolId: string, params: z.output<TSchema>): Promise<ToolResult>
  }
}
