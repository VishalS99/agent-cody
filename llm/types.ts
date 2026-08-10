import type { Messages } from "../schemas/messages.js"
import type OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources"
import * as z from "zod"

export type { OpenAI }

export const AvailableOpenAICompatModels = z.enum([
  "z-ai/glm-5.2",
  "deepseek-ai/deepseek-v4-flash",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
])
export type AvailableOpenAICompatModels = z.infer<
  typeof AvailableOpenAICompatModels
>
export const DefaultOpenAICompatTimeout = 30_000
export const DefaultOpenAICompatModel = "z-ai/glm-5.2"
export const DefaultMaxRetries = 3

export const ConfigSchema = z.object({
  model: AvailableOpenAICompatModels.default(DefaultOpenAICompatModel),
  baseURL: z.string().default("https://integrate.api.nvidia.com/v1"),
  apiKey: z.string().min(1),
  timeout: z.number().default(DefaultOpenAICompatTimeout),
  maxRetries: z.number().default(DefaultMaxRetries),
})

export type OpenAICompatConfig = z.infer<typeof ConfigSchema>

export type KnownApi = "openai-completions"

// Transport-layer request shape. The agent layer constructs this from its
// own AgentContext; llm/ never sees AgentContext, so it has no upward import.
// `tools` is OpenAI-native (ChatCompletionTool[]) intentionally: tool-def
// translation is the agent's job, not the transport's.
export interface LLMRequest {
  systemPrompt?: string
  messages: Messages[]
  tools?: ChatCompletionTool[]
}
