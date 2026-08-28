import type { ChatCompletionChunk, ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import { logger } from "../config/logger.js";
import type { ILLMClient } from "../llm/client.js";
import type { Messages } from "../schemas/messages.js";
import { runOptionalCompaction } from "./compaction/orchestrator.js";
import {
  EMPTY_RESPONSE_CONTINUATION_PROMPT,
  MAX_EMPTY_CONTINUATIONS,
  MAX_TOOL_ITERATIONS,
  RATE_LIMIT_STATUS,
  SERVICE_UNAVAILABLE_STATUS,
} from "./constants.js";
import { toLLMRequest } from "./context/llm_request.js";
import { isTaskIncomplete } from "./context/status.js";
import { insertMessage, insertToolMessageAndAction, type MessageRecord } from "./db.js";
import type { SessionStats } from "./stats.js";
import { recordLLMResponse, recordToolCall } from "./stats.js";
import { dispatchToolCall, findToolDefinition as findToolDefinitionHelper } from "./turn/dispatcher.js";
import { collectStream } from "./turn/stream.js";
import type { AgentContext, ToolAction, ToolDefinition, ToolResult, TurnHooks, TurnSummary } from "./types.js";

export class Agent {
  private client: ILLMClient;
  private agentContext: AgentContext;
  private stats: SessionStats;
  private model: string;
  private toolRoundCount: number = 0;
  private emptyContinuationCount = 0;
  private sessionId: string;
  private compactionCount: number;

  constructor(client: ILLMClient, context: AgentContext, stats: SessionStats, sessionId: string, compactionCount = 0) {
    this.client = client;
    this.agentContext = context;
    this.stats = stats;
    this.model = this.client.getModel();
    this.sessionId = sessionId;
    this.compactionCount = compactionCount;
  }

  async turn(prompt: string, hooks?: TurnHooks): Promise<TurnSummary> {
    const startTime = performance.now();
    this.emptyContinuationCount = 0;
    this.addMessage({ role: "user", content: prompt });

    let itr = 0;
    let reply = "";
    let toolCallCount = 0;
    while (itr++ < MAX_TOOL_ITERATIONS) {
      const llmStart = performance.now();
      const iterationStart = reply.length;
      let toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
      let finishReason: ChatCompletionChunk.Choice["finish_reason"] | undefined;
      let usage: ChatCompletionChunk["usage"] | undefined;

      try {
        const stream = await this.client.sendSRequest(toLLMRequest(this.agentContext));
        const aggregated = await collectStream(stream, piece => {
          reply += piece;
          hooks?.onDelta?.(piece);
        });
        toolCalls = aggregated.toolCalls;
        finishReason = aggregated.finishReason;
        usage = aggregated.usage;
        if (reply.length > iterationStart) hooks?.onDelta?.("\n");
      } catch (err) {
        const status = (err as { status?: number } | undefined)?.status;
        const isRateLimit = status === RATE_LIMIT_STATUS || status === SERVICE_UNAVAILABLE_STATUS;
        logger.error(
          {
            event: "llm_request_failed",
            status,
            error: (err as Error).message,
            iteration: itr,
          },
          isRateLimit ? "Rate limited, skipping turn" : "LLM request failed, skipping turn",
        );
        throw err;
      }

      const duration = performance.now() - llmStart;
      this.stats = recordLLMResponse(this.stats, {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        durationMs: Math.round(duration),
        model: this.model,
      });
      hooks?.onUsage?.(this.stats);
      logger.debug(
        {
          event: "model_response",
          model: this.model,
          iteration: itr,
          duration_ms: Math.round(duration),
          input_tokens: usage?.prompt_tokens,
          output_tokens: usage?.completion_tokens,
          finish_reason: finishReason,
          tool_calls: toolCalls.length,
          reply_chars: reply.length,
          compaction_count: this.compactionCount,
        },
        "Model response",
      );
      if (toolCalls.length === 0 || finishReason !== "tool_calls") {
        const iterationText = reply.slice(iterationStart);
        if (
          iterationText.trim() === "" &&
          isTaskIncomplete(this.agentContext) &&
          this.emptyContinuationCount < MAX_EMPTY_CONTINUATIONS
        ) {
          this.emptyContinuationCount++;
          this.addMessage({
            role: "user",
            content: EMPTY_RESPONSE_CONTINUATION_PROMPT,
          });
          logger.warn(
            {
              event: "empty_response_continuation",
              attempt: this.emptyContinuationCount,
              compaction_count: this.compactionCount,
            },
            "Model returned no content while action steps remain; continuing",
          );
          continue;
        }
        this.addMessage({ role: "assistant", content: reply });
        break;
      }

      this.addMessage({
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (call.type !== "function") continue;

        const toolStart = performance.now();
        hooks?.onToolCallStart?.(call);
        const result = await dispatchToolCall(this.agentContext, call, hooks);
        this.recordToolAction(call, call.function.name, result);
        hooks?.onToolCallResult?.(result);
        toolCallCount++;
        this.stats = recordToolCall(this.stats, {
          name: call.function.name,
          durationMs: Math.round(performance.now() - toolStart),
          isError: result.isError ?? false,
        });
        logger.info(
          {
            event: "tool_exec",
            name: `${this.findToolDefinition(call.function.name)?.function.emoji ?? ""} ${call.function.name}`,
            arguments: call.function.arguments,
            duration_ms: Math.round(performance.now() - toolStart),
            compaction_count: this.compactionCount,
          },
          "tool execution",
        );
      }

      this.toolRoundCount++;
      await this.runOptionalCompaction(hooks);

      if (itr === MAX_TOOL_ITERATIONS) {
        logger.warn(
          {
            event: "tool_loop_cap_reached",
            iterations: MAX_TOOL_ITERATIONS,
            compaction_count: this.compactionCount,
          },
          "Hit tool-call iteration cap; breaking out",
        );
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    hooks?.onTurnEnd?.(reply, toolCallCount);
    return { reply, toolCalls: toolCallCount, durationMs };
  }

  getStats(): SessionStats {
    return this.stats;
  }

  getAgentContext(): AgentContext {
    return this.agentContext;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getCompactionCount(): number {
    return this.compactionCount;
  }

  private async runOptionalCompaction(hooks?: TurnHooks): Promise<void> {
    const result = await runOptionalCompaction(
      {
        agentContext: this.agentContext,
        stats: this.stats,
        toolRoundCount: this.toolRoundCount,
        compactionCount: this.compactionCount,
      },
      {
        client: this.client,
        addMessage: (msg, kind) => this.addMessage(msg, kind),
        persistCompactionMessages: ctx => this.persistCompactionMessagesForContext(ctx),
      },
      hooks,
    );
    this.agentContext = result.agentContext;
    this.stats = result.stats;
    this.toolRoundCount = result.toolRoundCount;
    this.compactionCount = result.compactionCount;
  }

  private findToolDefinition(toolName: string): ToolDefinition | undefined {
    return findToolDefinitionHelper(this.agentContext, toolName);
  }

  private recordToolAction(call: ChatCompletionMessageFunctionToolCall, toolName: string, result: ToolResult): void {
    const toolCallId = result.tool_call_id ?? call.id;
    const action: ToolAction = {
      tool_call_id: toolCallId,
      tool: toolName,
      arguments: call.function.arguments,
      content: result.content,
      isError: result.isError ?? false,
      timestamp: Date.now(),
      ...(result.contextUpdate !== undefined ? { contextUpdate: result.contextUpdate } : {}),
    };

    this.agentContext.tool_actions_taken ||= [];
    this.agentContext.tool_actions_taken.push(action);

    const message: Messages = {
      role: "tool",
      content: "",
      tool_call_id: toolCallId,
      name: toolName,
    };
    this.agentContext.messages.push(message);
    insertToolMessageAndAction(
      {
        ...message,
        sessionId: this.sessionId,
        createdAt: action.timestamp,
        kind: "message",
      },
      { ...action, sessionId: this.sessionId },
    );
  }

  private addMessage(message: Messages, kind: MessageRecord["kind"] = "message"): void {
    this.agentContext.messages.push(message);
    this.persistMessage(message, kind);
  }

  private persistCompactionMessagesForContext(ctx: AgentContext): void {
    const [task, summary] = ctx.messages;
    if (!task || !summary) {
      throw new Error("Compaction did not produce a task and summary message");
    }
    insertMessage({
      ...task,
      sessionId: this.sessionId,
      createdAt: Date.now(),
      kind: "compaction_task",
    });
    insertMessage({
      ...summary,
      sessionId: this.sessionId,
      createdAt: Date.now(),
      kind: "compaction_summary",
    });
  }

  private persistMessage(message: Messages, kind: MessageRecord["kind"]): void {
    insertMessage({
      ...message,
      sessionId: this.sessionId,
      createdAt: Date.now(),
      kind,
    });
  }
}

export { hydrateToolMessages } from "./context/hydrate.js";
export { toLLMRequest } from "./context/llm_request.js";
