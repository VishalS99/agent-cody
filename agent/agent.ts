import type { ILLMClient } from "../llm/client.js";
import type { LLMRequest } from "../llm/types.js";
import type { AgentContext, ToolDefinition, ToolResult, TurnHooks, TurnSummary } from "./types.js";
import type { SessionStats } from "./stats.js";
import { recordToolCall, recordLLMResponse } from "./stats.js";
import { toWireTool } from "./util.js";
import { applyContextUpdate } from "./tools/context/manager.js";
import { buildRequestSystemPrompt } from "./prompt.js";
import { logger } from "../config/logger.js";
import type { ChatCompletionMessageFunctionToolCall, ChatCompletionChunk } from "openai/resources.js";

const MAX_TOOL_ITERATIONS = 50;

export class Agent {
  private client: ILLMClient;
  private agentContext: AgentContext;
  private stats: SessionStats;
  private model: string;

  constructor(client: ILLMClient, context: AgentContext, stats: SessionStats, model = "") {
    this.client = client;
    this.agentContext = context;
    this.stats = stats;
    this.model = model;
  }

  async turn(prompt: string, hooks?: TurnHooks): Promise<TurnSummary> {
    const startTime = performance.now();
    this.agentContext.messages.push({ role: "user", content: prompt });

    let itr = 0;
    let reply = "";
    let toolCallCount = 0;
    while (itr++ < MAX_TOOL_ITERATIONS) {
      const llmStart = performance.now();
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
      let finishReason: ChatCompletionChunk.Choice["finish_reason"] | undefined;
      let usage: ChatCompletionChunk["usage"] | undefined;
      try {
        const stream = await this.client.sendSRequest(this.toLLMRequest());
        const replyStart = reply.length;
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
        if (reply.length > replyStart) hooks?.onDelta?.("\n");
      } catch (err) {
        const status = (err as { status?: number } | undefined)?.status;
        const isRateLimit = status === 429 || status === 503;
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
        const result = await this.dispatchToolCall(call);
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

  toLLMRequest(): LLMRequest {
    const req: LLMRequest = { messages: this.agentContext.messages };

    if (this.agentContext.system_prompt) {
      req.systemPrompt = buildRequestSystemPrompt(this.agentContext);
    }
    if (this.agentContext.available_tools && this.agentContext.available_tools.length > 0) {
      req.tools = this.agentContext.available_tools.map(toWireTool);
    }
    return req;
  }

  findToolDefinition(toolName: string): ToolDefinition | undefined {
    return this.agentContext.available_tools?.find(t => t.function.name === toolName);
  }

  async dispatchToolCall(call: ChatCompletionMessageFunctionToolCall): Promise<ToolResult> {
    const tool = this.findToolDefinition(call.function.name);

    if (!tool) {
      this.agentContext.messages.push({
        role: "tool",
        content: JSON.stringify({
          error: `Tool '${call.function.name}' not found`,
        }),
        tool_call_id: call.id,
        name: call.function.name,
      });
      return {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Tool '${call.function.name}' not found`,
        }),
        isError: true,
      };
    }

    const parsedParams = tool.function.parameters.safeParse(JSON.parse(call.function.arguments));
    if (!parsedParams.success) {
      this.agentContext.messages.push({
        role: "tool",
        content: JSON.stringify({
          error: `Invalid arguments: ${parsedParams.error.message}`,
          arguments: call.function.arguments,
        }),
        tool_call_id: call.id,
        name: call.function.name,
      });

      return {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Invalid arguments: ${parsedParams.error.message}`,
          arguments: call.function.arguments,
        }),
        isError: true,
      };
    }

    let result: ToolResult;
    try {
      result = await tool.function.execute(call.id, parsedParams.data);
    } catch (err) {
      result = {
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `Execution error: ${(err as Error).message}`,
        }),
        isError: true,
      };
    }
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

    this.agentContext.messages.push({
      role: "tool",
      content: JSON.stringify({
        ...JSON.parse(result.content),
        ...result.contextUpdate,
      }),
      tool_call_id: result.tool_call_id ?? call.id,
      name: tool.function.name,
    });

    return result;
  }

  getStats(): SessionStats {
    return this.stats;
  }
}
