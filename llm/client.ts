import OpenAI from "openai"
import type { KnownApi, OpenAICompatConfig, LLMRequest } from "./types.js"
import type { Messages, Role } from "../schemas/messages.js"
import type { ChatCompletionMessageParam } from "openai/resources.js"
import { logger } from "../config/logger.js"
import type { APIPromise } from "openai/core/api-promise"
import type { Stream } from "openai/core/streaming"

// llm/ is the transport layer: it speaks OpenAI ChatCompletion shapes only.
// It deliberately has no import from agent/ — the agent builds LLMRequest.

export interface ILLMClient {
  getClient(): OpenAI
  sendMessage(messages: Messages[]): Promise<OpenAI.ChatCompletion>
  sendRequest(req: LLMRequest): Promise<OpenAI.ChatCompletion>
  sendSRequest(req: LLMRequest): APIPromise<Stream<OpenAI.ChatCompletionChunk>>
  transformMessages(messages: Messages[]): ChatCompletionMessageParam[]
  transformRequest(req: LLMRequest): ChatCompletionMessageParam[]
  printMessages(messages: Messages[], roles: Role[]): void
}

export class LLMClient implements ILLMClient {
  private client: OpenAI
  private model: string
  private reasoningEffort: "none" | "low" | "medium" | "high" = "none"

  constructor(api: KnownApi, config: OpenAICompatConfig) {
    this.client = createClient(api, config)
    this.model = config.model
    if (config.reasoningEffort) this.reasoningEffort = config.reasoningEffort
  }

  getClient(): OpenAI {
    return this.client
  }

  sendMessage(messages: Messages[]): Promise<OpenAI.ChatCompletion> {
    const transformedMessages = this.transformMessages(messages)
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: transformedMessages,
    }
    return this.client.chat.completions.create(request)
  }

  sendRequest(req: LLMRequest): Promise<OpenAI.ChatCompletion> {
    const transformedMessages = this.transformRequest(req)
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: transformedMessages,
      reasoning_effort: this.reasoningEffort,
    }
    if (req.tools && req.tools.length > 0) request.tools = req.tools
    return this.client.chat.completions.create(request)
  }

  sendSRequest(
    req: LLMRequest,
  ): APIPromise<Stream<OpenAI.ChatCompletionChunk>> {
    const transformedMessages = this.transformRequest(req)
    const request: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: transformedMessages,
      reasoning_effort: this.reasoningEffort,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }
    if (req.tools && req.tools.length > 0) request.tools = req.tools
    return this.client.chat.completions.create(request)
  }

  transformMessages(messages: Messages[]): ChatCompletionMessageParam[] {
    return messages.map((m) => this.toChatMessage(m))
  }

  transformRequest(req: LLMRequest): ChatCompletionMessageParam[] {
    const transformedMessages: ChatCompletionMessageParam[] = []

    if (req.systemPrompt && req.systemPrompt.trim() !== "") {
      transformedMessages.push({
        role: "system",
        content: req.systemPrompt.trim(),
      })
    } else {
      logger.warn(
        { error: "system prompt is empty" },
        "transform to messages from request",
      )
    }

    for (const msg of req.messages) {
      transformedMessages.push(this.toChatMessage(msg))
    }
    return transformedMessages
  }

  private toChatMessage(msg: Messages): ChatCompletionMessageParam {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content }
      case "user":
        return { role: "user", content: msg.content }
      case "assistant":
        return msg.tool_calls && msg.tool_calls.length > 0
          ? {
              role: "assistant",
              content: msg.content,
              tool_calls: msg.tool_calls,
            }
          : { role: "assistant", content: msg.content }
      case "tool":
        if (!msg.tool_call_id) {
          throw new Error("tool role messages require tool_call_id")
        }
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        }
    }
  }

  printMessages(messages: Messages[], roles: Role[]): void {
    const msgs = {} as Record<Role, Messages[]>
    for (const role of roles) msgs[role] = []
    for (const msg of messages) msgs[msg.role]?.push(msg)
    logger.info(
      { msgByRole: msgs, total: messages.length },
      "messages bucketed by role",
    )
  }
}

export function createClient(
  api: KnownApi,
  config: OpenAICompatConfig,
): OpenAI {
  if (api !== "openai-completions") {
    throw new Error(`Unknown API: ${api satisfies never}`)
  }
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    timeout: config.timeout,
    maxRetries: config.maxRetries,
  })
}
