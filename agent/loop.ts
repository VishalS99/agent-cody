import { SYSTEM_PROMPT } from "./prompt.js"
import type { AgentContext, ToolDefinition, ToolResult } from "./types.js"
import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { LLMClient } from "../llm/client.js"
import type { LLMRequest } from "../llm/types.js"
import { config } from "../config/env.js"
import { logger } from "../config/logger.js"
import { toWireTool } from "./util.js"
import { lsToolDefinition } from "./tools/ls.js"
import { readFileToolDefinition } from "./tools/read_file.js"
import { grepToolDefinition } from "./tools/grep.js"
import { createSessionStats, recordToolCall, recordLLMResponse } from "./stats.js"

import type { ChatCompletionMessageFunctionToolCall, ChatCompletionChunk } from "openai/resources.js"

const MAX_TOOL_ITERATIONS = 50

function toLLMRequest(context: AgentContext): LLMRequest {
  const req: LLMRequest = { messages: context.messages }
  if (context.system_prompt) req.systemPrompt = context.system_prompt
  if (context.available_tools && context.available_tools.length > 0) {
    req.tools = context.available_tools.map(toWireTool)
  }
  return req
}

function findToolDefinition(
  context: AgentContext,
  toolName: string,
): ToolDefinition | undefined {
  return context.available_tools?.find((t) => t.function.name === toolName)
}

async function dispatchToolCall(
  context: AgentContext,
  call: ChatCompletionMessageFunctionToolCall,
): Promise<ToolResult> {
  const tool = findToolDefinition(context, call.function.name)

  if (!tool) {
    context.messages.push({
      role: "tool",
      content: JSON.stringify({
        error: `Tool '${call.function.name}' not found`,
      }),
      tool_call_id: call.id,
      name: call.function.name,
    })
    return {
      tool_call_id: call.id,
      content: JSON.stringify({ error: `Tool '${call.function.name}' not found` }),
      isError: true,
    }
  }

  let toolParams
  try {
    toolParams = tool.function.parameters.parse(
      JSON.parse(call.function.arguments),
    )
  } catch (err) {
    context.messages.push({
      role: "tool",
      content: JSON.stringify({
        error: `Invalid arguments: ${(err as Error).message}`,
        arguments: call.function.arguments,
      }),
      tool_call_id: call.id,
      name: call.function.name,
    })

    return {
      tool_call_id: call.id,
      content: JSON.stringify({
        error: `Invalid arguments: ${(err as Error).message}`,
        arguments: call.function.arguments,
      }),
      isError: true,
    }
  }

  let result: ToolResult
  try {
    result = await tool.function.execute(call.id, toolParams)
  } catch (err) {
    result = {
      tool_call_id: call.id,
      content: JSON.stringify({
        error: `Execution error: ${(err as Error).message}`,
      }),
      isError: true,
    }
  }

  context.messages.push({
    role: "tool",
    content: result.content,
    tool_call_id: result.tool_call_id ?? call.id,
    name: tool.function.name,
  })

  return result
}

export async function runLoop(): Promise<void> {
  const context: AgentContext = {
    system_prompt: SYSTEM_PROMPT,
    messages: [],
    available_tools: [
      lsToolDefinition,
      readFileToolDefinition,
      grepToolDefinition,
    ],
  }

  let stats = createSessionStats()

  const client = new LLMClient("openai-completions", config)
  const rl = readline.createInterface({ input, output })

  while (true) {
    const answer = await rl.question("### Prompt: ")
    if (answer.trim() === "" || answer.trim() === "exit") {
      logger.info(
        {
          event: "runLoop_exit",
          stats: {
            toolCalls: stats.toolCalls,
            toolCallSuccesses: stats.toolCallSuccesses,
            toolCallFailures: stats.toolCallFailures,
            toolCallSuccessRate: stats.toolCalls ? stats.toolCallSuccesses / stats.toolCalls : 0,
            toolCallFailureRate: stats.toolCalls ? stats.toolCallFailures / stats.toolCalls : 0,
            avgToolCallDuration: stats.toolCalls ? stats.totalToolCallDuration / stats.toolCalls : 0,
            toolCallsByName: stats.toolCallsByName,
            totalLLMCalls: stats.totalLLMCalls,
            totalInputTokens: stats.totalInputTokens,
            totalOutputTokens: stats.totalOutputTokens,
            totalResponseDurationMs: stats.totalResponseDurationMs,
            avgResponseDurationMs: stats.totalLLMCalls ? stats.totalResponseDurationMs / stats.totalLLMCalls : 0,
            currentContextSize: stats.currentContextSize,
          },
        },
        "Bye!",
      )
      rl.close()
      return
    }

    context.messages.push({ role: "user", content: answer })

    let itr = 0
    while (itr++ < MAX_TOOL_ITERATIONS) {
      let reply = ""
      const startTime = performance.now()
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = []
      let finishReason: ChatCompletionChunk.Choice["finish_reason"] | undefined
      let usage: ChatCompletionChunk["usage"] | undefined
      try {
        const stream = await client.sendSRequest(toLLMRequest(context))
        
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          const piece = delta?.content ?? ""
          if (piece) {
            reply += piece
            process.stdout.write(piece)
          }
          for (const tc of delta?.tool_calls ?? []) {
            const existing = toolCalls[tc.index]
            if (!existing) {
              toolCalls[tc.index] = {
                id: tc.id ?? "",
                type: "function",
                function: {
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? "",
                },
              }
            } else {
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.function.name += tc.function.name
              existing.function.arguments += tc.function?.arguments ?? ""
            }
          }
          if (chunk.choices[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason
          }
          if (chunk.usage) usage = chunk.usage
        }
        process.stdout.write("\n")
      } catch (err) {
        const status = (err as any)?.status
        const isRateLimit = status === 429 || status === 503
        logger.error(
          { event: "llm_request_failed", status, error: (err as Error).message, iteration: itr },
          isRateLimit ? "Rate limited, skipping turn" : "LLM request failed, skipping turn",
        )
        if (isRateLimit) {
          process.stdout.write("\n[Rate limit hit — try again in a moment]\n")
        } else {
          process.stdout.write(`\n[LLM error: ${(err as Error).message}]\n`)
        }
        break
      }
      const duration = performance.now() - startTime
      stats = recordLLMResponse(stats, {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        durationMs: Math.round(duration),
        model: config.model,
      })
      logger.info(
        {
          event: "model_response",
          model: config.model,
          iteration: itr,
          duration_ms: Math.round(duration),
          input_tokens: usage?.prompt_tokens,
          output_tokens: usage?.completion_tokens,
          finish_reason: finishReason,
          tool_calls: toolCalls.length,
          reply_chars: reply.length,
        },
        "Model response",
      )
      if (toolCalls.length === 0 || finishReason !== "tool_calls") {
        context.messages.push({ role: "assistant", content: reply })
        break
      }

      context.messages.push({
        role: "assistant",
        content: reply,
        tool_calls: toolCalls,
      })

      for (const call of toolCalls) {
        if (call.type !== "function") continue
        const toolStart = performance.now()
        const result = await dispatchToolCall(context, call)
        stats = recordToolCall(stats, {
          name: call.function.name,
          durationMs: Math.round(performance.now() - toolStart),
          isError: result.isError ?? false,
        })
        logger.info(
          {
            event: "tool_exec",
            name: call.function.name,
            arguments: call.function.arguments,
            duration_ms: Math.round(performance.now() - toolStart),
          },
          "tool execution",
        )
      }

      if (itr === MAX_TOOL_ITERATIONS) {
        logger.warn(
          { event: "tool_loop_cap_reached", iterations: MAX_TOOL_ITERATIONS },
          "Hit tool-call iteration cap; breaking out",
        )
        process.stdout.write("\n")
      }
    }
  }
}
