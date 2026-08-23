import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { config } from "../config/env.js";
import { logger, logLedger, visualLines, writeLedgerLine } from "../config/logger.js";
import { LLMClient } from "../llm/client.js";
import { Agent } from "./agent.js";
import {
  ANSI_BOLD_YELLOW,
  ANSI_DIM_GREY,
  ANSI_DIM_WHITE_ITALIC,
  ANSI_ITALIC_GREEN,
  ANSI_RESET,
  CLI_EXIT_COMMAND,
  CLI_INPUT_PROMPT,
  DEFAULT_SCREEN_ROWS,
  FORCED_COMPACTION_NOTICE,
  RATE_LIMIT_STATUS,
  HORIZONTAL_SEPARATOR,
  REPLY_PREFIX,
  SCHEDULED_COMPACTION_NOTICE,
  SERVICE_UNAVAILABLE_STATUS,
  TOOLS_CALLED_ANNOTATION,
} from "./constants.js";
import { buildSystemPrompt } from "./prompt/prompt.js";
import { createSessionStats } from "./stats.js";
import { bashExecToolDefinition } from "./tools/bash_exec.js";
import { goalsToolDefinition } from "./tools/context/goals.js";
import { stateToolDefinition } from "./tools/context/state.js";
import { editFileToolDefinition } from "./tools/edit_file.js";
import { fileToolDefinition } from "./tools/file.js";
import { allowedRoot } from "./tools/fs_guard.js";
import { grepToolDefinition } from "./tools/grep.js";
import { lsToolDefinition } from "./tools/ls.js";
import { readFileToolDefinition } from "./tools/read_file.js";
import type { AgentContext } from "./types.js";

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
      bashExecToolDefinition,
      goalsToolDefinition,
      stateToolDefinition,
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
  const agent = new Agent(client, context, createSessionStats());

  const rl = readline.createInterface({ input, output });

  while (true) {
    let answer: string;
    try {
      answer = await rl.question(CLI_INPUT_PROMPT);
    } catch {
      rl.close();
      return;
    }
    if (answer.trim() === "" || answer.trim() === CLI_EXIT_COMMAND) {
      logger.info({ event: "runLoop_exit", stats: agent.getStats() }, "Bye!");
      rl.close();
      return;
    }

    try {
      process.stdout.write(REPLY_PREFIX);
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
        onStepCompleted: (step, index, nextStep) => {
          process.stdout.write(`\n✓ Step ${index + 1} completed: ${ANSI_ITALIC_GREEN}${step.action}${ANSI_RESET}\n`);
          if (nextStep) process.stdout.write(`→ Next: ${ANSI_BOLD_YELLOW}${nextStep.action}${ANSI_RESET}\n`);
        },
        onCompactionStart: kind => {
          writeLedgerLine(kind === "forced" ? FORCED_COMPACTION_NOTICE : SCHEDULED_COMPACTION_NOTICE);
        },
        onCompactionApplied: summary => {
          if (summary === "") return;
          writeLedgerLine(`${ANSI_DIM_WHITE_ITALIC}${summary}${ANSI_RESET}\n`);
        },
      });
      if (cur !== "") {
        segments.push(cur);
        boundaries.push(logLedger.length);
      }

      if (process.stdout.isTTY && streamed.length > 0) {
        const blockLogs = logLedger.slice(ledgerStart);
        const blockLines = blockLogs.reduce((a, e) => a + e.lines, 0);
        // Every piece after "> " advances the cursor by visualLines - 1:
        // its trailing "\n" row is shared with the next piece.
        const up = blockLines + visualLines(streamed) - (blockLogs.length + 1);
        const screenRows = process.stdout.rows ?? DEFAULT_SCREEN_ROWS;
        if (up >= 0 && up < screenRows) {
          process.stdout.write(`\x1b[${up}A\x1b[J`);
          process.stdout.write(REPLY_PREFIX);
          for (const entry of blockLogs) process.stdout.write(entry.text);
          let annotated = "";
          segments.forEach((seg, i) => {
            const rendered = Bun.markdown.ansi(seg);
            annotated += rendered;
            if (!rendered.endsWith("\n")) annotated += "\n";
            const hadTools = logLedger.slice(boundaries[i], boundaries[i + 1]).length > 0;
            if (hadTools) annotated += TOOLS_CALLED_ANNOTATION;
          });
          process.stdout.write(annotated);
          process.stdout.write(
            `${ANSI_DIM_GREY}${HORIZONTAL_SEPARATOR.repeat(process.stdout.columns ?? 80)}${ANSI_RESET}\n`,
          );
        } else {
          process.stdout.write("\n");
        }
      } else {
        process.stdout.write("\n");
        process.stdout.write(
          `${ANSI_DIM_GREY}${HORIZONTAL_SEPARATOR.repeat(process.stdout.columns ?? 80)}${ANSI_RESET}\n`,
        );
      }
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      const isRateLimit = status === RATE_LIMIT_STATUS || status === SERVICE_UNAVAILABLE_STATUS;
      if (isRateLimit) {
        process.stdout.write("\n[Rate limit hit — try again in a moment]\n");
      } else {
        process.stdout.write(`\n[LLM error: ${(err as Error).message}]\n`);
      }
    }
  }
}
