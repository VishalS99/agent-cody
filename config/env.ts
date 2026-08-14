import { ConfigSchema } from "../llm/types.js"
import type { OpenAICompatConfig } from "../llm/types.js"

export const config: OpenAICompatConfig = ConfigSchema.parse({
  model: process.env.MODEL,
  baseURL: process.env.BASE_URL,
  apiKey: process.env.API_KEY,
})
