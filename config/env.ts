import { ConfigSchema } from "../llm/types.js"
import type { OpenAICompatConfig } from "../llm/types.js"

export const config: OpenAICompatConfig = ConfigSchema.parse({
  model: process.env.NVIDIA_MODEL,
  baseURL: process.env.NVIDIA_BASE_URL,
  apiKey: process.env.NVIDIA_API_KEY,
})
