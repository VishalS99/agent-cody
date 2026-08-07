import type { ChatCompletionMessageToolCall } from "openai/resources"

export type { ChatCompletionMessageToolCall as ToolCall }

export type Role = "system" | "user" | "assistant" | "tool"

export interface Messages {
  role: Role
  content: string
  tool_calls?: ChatCompletionMessageToolCall[]
  tool_call_id?: string
  name?: string
}
