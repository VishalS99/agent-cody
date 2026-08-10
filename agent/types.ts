import type { Messages, ToolCall } from "../schemas/messages.js"
import type { SessionStats } from "./stats.js"
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
    emoji: string
    parameters: TSchema
    execute(toolId: string, params: z.output<TSchema>): Promise<ToolResult>
  }
}

export interface TurnHooks {
  onDelta?: (text: string) => void
  onToolCallStart?: (call: ToolCall) => void
  onToolCallResult?: (result: ToolResult) => void
  onUsage?: (usage: SessionStats) => void
  onTurnEnd?: (reply: string, toolCalls: number) => void
}

export interface TurnSummary {
  reply: string
  toolCalls: number
  durationMs: number
}
