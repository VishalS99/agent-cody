import { buildSystemPrompt } from "./prompt.js";
import type { AgentContext } from "./types.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { LLMClient } from "../llm/client.js";
import { config } from "../config/env.js";
import { logger, logLedger, visualLines } from "../config/logger.js";
import { lsToolDefinition } from "./tools/ls.js";
import { readFileToolDefinition } from "./tools/read_file.js";
import { grepToolDefinition } from "./tools/grep.js";
import { Agent } from "./agent.js";
import { editFileToolDefinition } from "./tools/edit_file.js";
import { fileToolDefinition } from "./tools/file.js";
import { createSessionStats } from "./stats.js";
import { allowedRoot } from "./tools/fs_guard.js";
import { goalsToolDefinition } from "./tools/context/goals.js";
import { stateToolDefinition } from "./tools/context/state.js";

async function buildAgentContext(): Promise<AgentContext> {
  const root = await allowedRoot();

  const context: AgentContext = {
    system_prompt: buildSystemPrompt(root),
    messages: [],
    available_tools: [
      lsToolDefinition,
      readFileToolDefinition,
      grepToolDefinition,
      editFileToolDefinition,
      fileToolDefinition,
      goalsToolDefinition,
      stateToolDefinition
    ],
    tool_actions_taken: [],
  };

  // goals, action steps, state are initialized when a task is assigned and the agent calls
  // tools to initialize them
  return context;
}

export async function runLoop(): Promise<void> {
  const context = await buildAgentContext();
  const client = new LLMClient("openai-completions", config);
  const agent = new Agent(client, context, createSessionStats(), config.model);

  const rl = readline.createInterface({ input, output });

  while (true) {
    let answer: string;
    try {
      answer = await rl.question("\n\x1b[1m\x1b[94m\x1b[100m cody> \x1b[0m ");
    } catch {
      rl.close();
      return;
    }
    if (answer.trim() === "" || answer.trim() === "exit") {
      logger.info({ event: "runLoop_exit", stats: agent.getStats() }, "Bye!");
      rl.close();
      return;
    }

    try {
      process.stdout.write("> ");
      const ledgerStart = logLedger.length;
      let streamed = "";
      let cur = "";
      const segments: string[] = [];
      const boundaries: number[] = [];
      await agent.turn(answer, {
        onDelta: text => {
          if (text === "\n") {
            if (cur !== "") {
              segments.push(cur);
              cur = "";
              boundaries.push(logLedger.length);
            }
          } else {
            cur += text;
          }
          streamed += text;
          process.stdout.write(text);
        },
      });

      if (process.stdout.isTTY && streamed.length > 0) {
        const blockLogs = logLedger.slice(ledgerStart);
        const blockLines = blockLogs.reduce((a, e) => a + e.lines, 0);
        // Every piece after "> " advances the cursor by visualLines - 1:
        // its trailing "\n" row is shared with the next piece.
        const up = blockLines + visualLines(streamed) - (blockLogs.length + 1);
        const screenRows = process.stdout.rows ?? 24;
        if (up >= 0 && up < screenRows) {
          process.stdout.write(`\x1b[${up}A\x1b[J`);
          process.stdout.write("> ");
          for (const entry of blockLogs) process.stdout.write(entry.text);
          let annotated = "";
          segments.forEach((seg, i) => {
            const rendered = Bun.markdown.ansi(seg);
            annotated += rendered;
            if (!rendered.endsWith("\n")) annotated += "\n";
            const hadTools = logLedger.slice(boundaries[i], boundaries[i + 1]).length > 0;
            if (hadTools) annotated += "\x1b[2m(tools were called)\x1b[0m\n";
          });
          process.stdout.write(annotated);
        } else {
          process.stdout.write("\n");
        }
      } else {
        process.stdout.write("\n");
      }
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      const isRateLimit = status === 429 || status === 503;
      if (isRateLimit) {
        process.stdout.write("\n[Rate limit hit — try again in a moment]\n");
      } else {
        process.stdout.write(`\n[LLM error: ${(err as Error).message}]\n`);
      }
    }
  }
}
