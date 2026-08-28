import { logger } from "../../config/logger.js";
import type { ILLMClient } from "../../llm/client.js";
import { COMPACTION_NEAR_LIMIT_RATIO, COMPACTION_TURN_THRESHOLD, CONTEXT_BUDGET_TOKENS } from "../constants.js";
import { buildLeanContext } from "../context/clone.js";
import { estimateContextTokens } from "../context/tokens.js";
import type { SessionStats } from "../stats.js";
import { recordContextEstimate, recordInternalUsage } from "../stats.js";
import type { SummaryResult } from "../tools/context/compact.js";
import { compactContext, requestSummary } from "../tools/context/compact.js";
import type { AgentContext, TurnHooks } from "../types.js";

export interface CompactionState {
  agentContext: AgentContext;
  stats: SessionStats;
  toolRoundCount: number;
  compactionCount: number;
}

export interface CompactionDeps {
  client: ILLMClient;
  addMessage: (
    msg: AgentContext["messages"][number],
    kind?: "message" | "compaction_task" | "compaction_summary",
  ) => void;
  persistCompactionMessages: (ctx: AgentContext) => void;
}

export async function runOptionalCompaction(
  state: CompactionState,
  deps: CompactionDeps,
  hooks?: TurnHooks,
): Promise<CompactionState> {
  let { agentContext, stats, toolRoundCount, compactionCount } = state;
  const nearLimit = stats.currentContextTokens > COMPACTION_NEAR_LIMIT_RATIO * CONTEXT_BUDGET_TOKENS;

  if (stats.currentContextTokens > 0.8 * CONTEXT_BUDGET_TOKENS) {
    hooks?.onCompactionStart?.("forced");
    const summaryResult: SummaryResult = await requestSummary(buildLeanContext(agentContext), deps.client, nearLimit);
    stats = recordInternalUsage(
      stats,
      summaryResult.ok ? summaryResult.usage : { inputTokens: 0, outputTokens: 0, durationMs: 0 },
    );
    if (summaryResult.ok) {
      replaceTranscript(agentContext, summaryResult.content, deps.addMessage);
      compactionCount++;
      toolRoundCount = 0;
      stats = recordContextEstimate(stats, estimateContextTokens(agentContext));
      hooks?.onCompactionApplied?.(summaryResult.content, "forced");
      logger.info(
        {
          event: "forced_compaction",
          context_tokens: stats.currentContextTokens,
          compaction_count: compactionCount,
        },
        "Forced context compaction applied",
      );
    } else {
      logger.warn(
        {
          event: "forced_compaction_failed",
          error: summaryResult.error,
        },
        "Forced context compaction failed",
      );
    }
    return { agentContext, stats, toolRoundCount, compactionCount };
  }

  if (toolRoundCount % COMPACTION_TURN_THRESHOLD === 0) {
    hooks?.onCompactionStart?.("scheduled");
    try {
      const res = await compactContext(agentContext, deps.client, nearLimit);
      if (res.usage) {
        stats = recordInternalUsage(stats, res.usage);
      }
      logger.info(
        {
          event: "compaction_rubric",
          status: res.status,
          compaction_count: compactionCount,
          ...(res.error ? { error: res.error } : {}),
        },
        "Compaction rubric decision",
      );
      if (res.status === "COMPRESS") {
        agentContext = res.context;
        deps.persistCompactionMessages(agentContext);
        compactionCount++;
        toolRoundCount = 0;
        stats = recordContextEstimate(stats, estimateContextTokens(agentContext));
        const appliedSummary = agentContext.messages[agentContext.messages.length - 1]?.content ?? "";
        hooks?.onCompactionApplied?.(appliedSummary, "scheduled");
        logger.info(
          {
            event: "compaction_applied",
            context_tokens: stats.currentContextTokens,
            compaction_count: compactionCount,
          },
          "Context compaction applied — history summarized; continuing from the current step",
        );
      }
    } catch (error) {
      logger.warn(
        {
          event: "compaction_rubric_error",
          error: error instanceof Error ? error.message : String(error),
        },
        "Compaction rubric errored; continuing with existing context",
      );
    }
  }

  return { agentContext, stats, toolRoundCount, compactionCount };
}

function replaceTranscript(
  agentContext: AgentContext,
  summary: string,
  addMessage: CompactionDeps["addMessage"],
): void {
  const userMessage = agentContext.messages.find(m => m.role === "user");
  const taskRequest =
    agentContext.task_request ?? (typeof userMessage?.content === "string" ? userMessage.content : "");
  agentContext.messages = [];
  agentContext.tool_actions_taken = [];
  addMessage({ role: "user", content: taskRequest }, "compaction_task");
  addMessage({ role: "assistant", content: summary }, "compaction_summary");
}
