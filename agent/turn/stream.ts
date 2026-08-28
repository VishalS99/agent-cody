import type { ChatCompletionChunk, ChatCompletionMessageFunctionToolCall } from "openai/resources.js";

export interface StreamAggregation {
  toolCalls: ChatCompletionMessageFunctionToolCall[];
  finishReason?: ChatCompletionChunk.Choice["finish_reason"] | undefined;
  usage?: ChatCompletionChunk["usage"] | undefined;
  replyDelta: string;
}

export async function collectStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  onDelta?: (piece: string) => void,
): Promise<StreamAggregation> {
  let replyDelta = "";
  const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
  let finishReason: ChatCompletionChunk.Choice["finish_reason"] | undefined;
  let usage: ChatCompletionChunk["usage"] | undefined;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const piece = delta?.content ?? "";
    if (piece) {
      replyDelta += piece;
      onDelta?.(piece);
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

  return { toolCalls, finishReason, usage, replyDelta };
}
