import type { ChatCompletionChunk, ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import { logger } from "../config/logger.js";
import type { ILLMClient } from "../llm/client.js";
import type { LLMRequest } from "../llm/types.js";
import type { Messages } from "../schemas/messages.js";
import {
  COMPACTION_NEAR_LIMIT_RATIO,
  COMPACTION_TURN_THRESHOLD,
  CONTEXT_BUDGET_TOKENS,
  EMPTY_RESPONSE_CONTINUATION_PROMPT,
  MAX_EMPTY_CONTINUATIONS,
  MAX_TOOL_ITERATIONS,
  RATE_LIMIT_STATUS,
  SERVICE_UNAVAILABLE_STATUS,
} from "./constants.js";
import { buildRequestSystemPrompt } from "./prompt/prompt.js";
import type { SessionStats } from "./stats.js";
import { recordContextEstimate, recordInternalUsage, recordLLMResponse, recordToolCall } from "./stats.js";
import type { SummaryResult } from "./tools/context/compact.js";
import { buildLeanContext, compactContext, requestSummary } from "./tools/context/compact.js";
import { applyContextUpdate } from "./tools/context/manager.js";
import type { AgentContext, ToolAction, ToolDefinition, ToolResult, TurnHooks, TurnSummary } from "./types.js";
import { toWireTool } from "./util.js";

export class Agent {
  private client: ILLMClient;
  private agentContext: AgentContext;
  private stats: SessionStats;
  private model: string;
  private toolRoundCount: number = 0;
  private emptyContinuationCount = 0;

  constructor(client: ILLMClient, context: AgentContext, stats: SessionStats, model = "") {
    this.client = client;
    this.agentContext = context;
    this.stats = stats;
    this.model = model;
  }

  async turn(prompt: string, hooks?: TurnHooks): Promise<TurnSummary> {
    const startTime = performance.now();
    this.emptyContinuationCount = 0;
    this.agentContext.messages.push({ role: "user", content: prompt });

    let itr = 0;
    let reply = "";
    let toolCallCount = 0;
    while (itr++ < MAX_TOOL_ITERATIONS) {
      const llmStart = performance.now();
      const iterationStart = reply.length;
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
      let finishReason: ChatCompletionChunk.Choice["finish_reason"] | undefined;
      let usage: ChatCompletionChunk["usage"] | undefined;
      try {
        const stream = await this.client.sendSRequest(toLLMRequest(this.agentContext));
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          const piece = delta?.content ?? "";
          if (piece) {
            reply += piece;
            hooks?.onDelta?.(piece);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const existing = toolCalls[tc.index];
            if (!existing) {
              toolCalls[tc.index] = {
                id: tc.id ?? "",
                type: "function",
                function: {
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? "",
                },
              };
            } else {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.function.name += tc.function.name;
              existing.function.arguments += tc.function?.arguments ?? "";
            }
          }
          if (chunk.choices[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) usage = chunk.usage;
        }
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
        },
        "Model response",
      );
      if (toolCalls.length === 0 || finishReason !== "tool_calls") {
        const iterationText = reply.slice(iterationStart);
        if (
          iterationText.trim() === "" &&
          this.isTaskIncomplete() &&
          this.emptyContinuationCount < MAX_EMPTY_CONTINUATIONS
        ) {
          this.emptyContinuationCount++;
          this.agentContext.messages.push({
            role: "user",
            content: EMPTY_RESPONSE_CONTINUATION_PROMPT,
          });
          logger.warn(
            { event: "empty_response_continuation", attempt: this.emptyContinuationCount },
            "Model returned no content while action steps remain; continuing",
          );
          continue;
        }
        this.agentContext.messages.push({ role: "assistant", content: reply });
        break;
      }

      this.agentContext.messages.push({
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (call.type !== "function") continue;

        const toolStart = performance.now();
        hooks?.onToolCallStart?.(call);
        const result = await this.dispatchToolCall(call, hooks);
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
          },
          "tool execution",
        );
      }

      this.toolRoundCount++;
      await this.runOptionalCompaction();

      if (itr === MAX_TOOL_ITERATIONS) {
        logger.warn(
          { event: "tool_loop_cap_reached", iterations: MAX_TOOL_ITERATIONS },
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

  private async runOptionalCompaction(): Promise<void> {
    const nearLimit = this.stats.currentContextTokens > COMPACTION_NEAR_LIMIT_RATIO * CONTEXT_BUDGET_TOKENS;

    if (this.stats.currentContextTokens > 0.8 * CONTEXT_BUDGET_TOKENS) {
      const summaryResult: SummaryResult = await requestSummary(
        buildLeanContext(this.agentContext),
        this.client,
        nearLimit,
      );
      this.stats = recordInternalUsage(
        this.stats,
        summaryResult.ok ? summaryResult.usage : { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      );
      if (summaryResult.ok) {
        this.replaceTranscript(summaryResult.content);
        this.toolRoundCount = 0;
        this.stats = recordContextEstimate(this.stats, this.estimateContextTokens(this.agentContext));
        logger.info(
          { event: "forced_compaction", context_tokens: this.stats.currentContextTokens },
          "Forced context compaction applied",
        );
      } else {
        logger.warn(
          { event: "forced_compaction_failed", error: summaryResult.error },
          "Forced context compaction failed",
        );
      }
      return;
    }

    if (this.toolRoundCount % COMPACTION_TURN_THRESHOLD === 0) {
      try {
        const res = await compactContext(this.agentContext, this.client, nearLimit);
        if (res.usage) {
          this.stats = recordInternalUsage(this.stats, res.usage);
        }
        logger.info(
          { event: "compaction_rubric", status: res.status, ...(res.error ? { error: res.error } : {}) },
          "Compaction rubric decision",
        );
        if (res.status === "COMPRESS") {
          this.agentContext = res.context;
          this.toolRoundCount = 0;
          this.stats = recordContextEstimate(this.stats, this.estimateContextTokens(this.agentContext));
        }
      } catch (error) {
        logger.warn(
          { event: "compaction_rubric_error", error: error instanceof Error ? error.message : String(error) },
          "Compaction rubric errored; continuing with existing context",
        );
      }
    }
  }

  private replaceTranscript(summary: string): void {
    const userMessage = this.agentContext.messages.find(m => m.role === "user");
    const taskRequest =
      this.agentContext.task_request ?? (typeof userMessage?.content === "string" ? userMessage.content : "");
    this.agentContext = {
      ...this.agentContext,
      messages: [
        { role: "user", content: taskRequest },
        { role: "assistant", content: summary },
      ],
      tool_actions_taken: [],
    };
  }

  private estimateContextTokens(context: AgentContext): number {
    const system = buildRequestSystemPrompt(context);
    const transcript = context.messages
      .map(message => `${message.role}:${message.content ?? ""}${message.tool_call_id ?? ""}`)
      .join("\n");
    return Math.max(1, Math.round((system.length + transcript.length) / 4));
  }

  private isTaskIncomplete(): boolean {
    return (this.agentContext.action_steps ?? []).some(step => step.status !== "completed");
  }

  private findToolDefinition(toolName: string): ToolDefinition | undefined {
    return this.agentContext.available_tools?.find(t => t.function.name === toolName);
  }

  private async dispatchToolCall(call: ChatCompletionMessageFunctionToolCall, hooks?: TurnHooks): Promise<ToolResult> {
    const tool = this.findToolDefinition(call.function.name);

    if (!tool) {
      const result: ToolResult = {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Tool '${call.function.name}' not found`,
        }),
        isError: true,
      };
      this.recordToolAction(call, call.function.name, result);
      return result;
    }

    let rawParams: unknown;
    try {
      rawParams = JSON.parse(call.function.arguments);
    } catch {
      const result: ToolResult = {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: "Invalid JSON tool arguments",
        }),
        isError: true,
      };
      this.recordToolAction(call, tool.function.name, result);
      return result;
    }

    const parsedParams = tool.function.parameters.safeParse(rawParams);
    if (!parsedParams.success) {
      const result: ToolResult = {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Invalid arguments: ${parsedParams.error.message}`,
        }),
        isError: true,
      };
      this.recordToolAction(call, tool.function.name, result);
      return result;
    }

    let result: ToolResult;
    try {
      result = await tool.function.execute(call.id, parsedParams.data);
    } catch (err) {
      result = {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        }),
        isError: true,
      };
    }
    const completedIndex =
      result.contextUpdate?.type === "update_state" ? result.contextUpdate.step_completed : undefined;
    if (!result.isError && result.contextUpdate) {
      try {
        applyContextUpdate(this.agentContext, result.contextUpdate);
      } catch (err) {
        result = {
          ...result,
          content: JSON.stringify({
            error: `Context update error: ${err instanceof Error ? err.message : String(err)}`,
          }),
          isError: true,
        };
      }
    }

    this.recordToolAction(call, tool.function.name, result);

    if (!result.isError && completedIndex !== undefined) {
      const completedStep = this.agentContext.action_steps?.[completedIndex];
      const nextStep = this.agentContext.action_steps?.[completedIndex + 1];
      if (completedStep) hooks?.onStepCompleted?.(completedStep, completedIndex, nextStep);
    }

    return result;
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

    this.agentContext.messages.push({
      role: "tool",
      content: "",
      tool_call_id: toolCallId,
      name: toolName,
    });
  }
}

export function hydrateToolMessages(context: AgentContext): Messages[] {
  const toolMap = new Map((context.tool_actions_taken ?? []).map(action => [action.tool_call_id, action]));

  return context.messages.map(msg => {
    if (msg.role !== "tool") {
      return msg;
    }

    const tool = toolMap.get(msg.tool_call_id ?? "");
    if (!tool) {
      throw new Error(`Missing stored tool action for call ${msg.tool_call_id ?? "(unknown)"}`);
    }

    return { ...msg, content: tool.content };
  });
}

export function toLLMRequest(context: AgentContext, isTempReq: boolean = false): LLMRequest {
  const hydratedMessages = hydrateToolMessages(context);
  const req: LLMRequest = { messages: hydratedMessages };

  if (context.system_prompt) {
    req.systemPrompt = buildRequestSystemPrompt(context);
  }

  if (isTempReq) return req;
  const availableTools = context.available_tools;
  if (availableTools && availableTools.length > 0) {
    req.tools = availableTools.map(toWireTool);
  }

  return req;
}
