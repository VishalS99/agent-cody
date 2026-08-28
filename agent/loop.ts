import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { logger, logLedger, writeLedgerLine } from "../config/logger.js";
import type { Agent } from "./agent.js";
import {
  ANSI_BOLD_YELLOW,
  ANSI_DIM_WHITE_ITALIC,
  ANSI_ITALIC_GREEN,
  ANSI_RESET,
  CLI_EXIT_COMMAND,
  CLI_INPUT_PROMPT,
  FORCED_COMPACTION_NOTICE,
  RATE_LIMIT_STATUS,
  REPLY_PREFIX,
  SCHEDULED_COMPACTION_NOTICE,
  SERVICE_UNAVAILABLE_STATUS,
} from "./constants.js";
import { renderTurnOutput } from "./loop/render.js";

export async function runLoop(agent: Agent): Promise<void> {
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
      logger.info(
        {
          event: "runLoop_exit",
          stats: agent.getStats(),
          compaction_count: agent.getCompactionCount(),
        },
        "Bye!",
      );
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

      renderTurnOutput(ledgerStart, streamed, segments, boundaries);
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
