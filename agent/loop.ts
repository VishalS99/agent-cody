import { buildSystemPrompt } from "./prompt.js"
import type { AgentContext } from "./types.js"
import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { LLMClient } from "../llm/client.js"
import { config } from "../config/env.js"
import { logger } from "../config/logger.js"
import { lsToolDefinition } from "./tools/ls.js"
import { readFileToolDefinition } from "./tools/read_file.js"
import { grepToolDefinition } from "./tools/grep.js"
import { Agent } from "./agent.js"
import { editFileToolDefinition } from "./tools/edit_file.js"
import { fileToolDefinition } from "./tools/file.js"
import { createSessionStats } from "./stats.js"
import { allowedRoot } from "./tools/fs_guard.js"

export async function runLoop(): Promise<void> {
  const root = await allowedRoot()
  const context: AgentContext = {
    system_prompt: buildSystemPrompt(root),
    messages: [],
    available_tools: [
      lsToolDefinition,
      readFileToolDefinition,
      grepToolDefinition,
      editFileToolDefinition,
      fileToolDefinition,
    ],
  }

  const client = new LLMClient("openai-completions", config)
  const agent = new Agent(client, context, createSessionStats(), config.model)

  const rl = readline.createInterface({ input, output })

  while (true) {
    let answer: string
    try {
      answer = await rl.question("### Prompt: ")
    } catch {
      rl.close()
      return
    }
    if (answer.trim() === "" || answer.trim() === "exit") {
      logger.info({ event: "runLoop_exit", stats: agent.getStats() }, "Bye!")
      rl.close()
      return
    }

    try {
      const _ = await agent.turn(answer, {
        onDelta: (text) => process.stdout.write(text),
      })
      process.stdout.write("\n")
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status
      const isRateLimit = status === 429 || status === 503
      if (isRateLimit) {
        process.stdout.write("\n[Rate limit hit — try again in a moment]\n")
      } else {
        process.stdout.write(`\n[LLM error: ${(err as Error).message}]\n`)
      }
    }
  }
}
