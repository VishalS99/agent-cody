import type { OpenAICompatConfig } from "../llm/types.js";
import { ConfigSchema } from "../llm/types.js";

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config: OpenAICompatConfig = ConfigSchema.parse({
  model: process.env.MODEL,
  baseURL: process.env.BASE_URL,
  apiKey: requiredEnv("API_KEY"),
});
