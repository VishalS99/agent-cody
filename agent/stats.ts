export interface SessionStats {
  toolCalls: number;
  toolCallSuccesses: number;
  toolCallFailures: number;
  totalToolCallDuration: number;
  toolCallsByName: Record<string, number>;
  toolFailuresByName: Record<string, number>;
  totalLLMCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalResponseDurationMs: number;
  currentContextSize: number;
}

export function createSessionStats(): SessionStats {
  return {
    toolCalls: 0,
    toolCallSuccesses: 0,
    toolCallFailures: 0,
    totalToolCallDuration: 0,
    toolCallsByName: {},
    toolFailuresByName: {},
    totalLLMCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalResponseDurationMs: 0,
    currentContextSize: 0,
  };
}

export function recordToolCall(
  stats: SessionStats,
  call: { name: string; durationMs: number; isError: boolean },
): SessionStats {
  return {
    ...stats,
    toolCalls: stats.toolCalls + 1,
    toolCallSuccesses: stats.toolCallSuccesses + (call.isError ? 0 : 1),
    toolCallFailures: stats.toolCallFailures + (call.isError ? 1 : 0),
    totalToolCallDuration: stats.totalToolCallDuration + call.durationMs,
    toolCallsByName: {
      ...stats.toolCallsByName,
      [call.name]: (stats.toolCallsByName[call.name] ?? 0) + 1,
    },
    toolFailuresByName: {
      ...stats.toolFailuresByName,
      [call.name]: (stats.toolFailuresByName[call.name] ?? 0) + (call.isError ? 1 : 0),
    },
  };
}

export function recordLLMResponse(
  stats: SessionStats,
  resp: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    model: string;
  },
): SessionStats {
  return {
    ...stats,
    totalLLMCalls: stats.totalLLMCalls + 1,
    totalInputTokens: stats.totalInputTokens + resp.inputTokens,
    totalOutputTokens: stats.totalOutputTokens + resp.outputTokens,
    totalResponseDurationMs: stats.totalResponseDurationMs + resp.durationMs,
    currentContextSize: resp.inputTokens,
  };
}

export function toolAverageCallDuration(stats: SessionStats): number {
  return stats.toolCalls === 0 ? 0 : stats.totalToolCallDuration / stats.toolCalls;
}

export function toolCallSuccessRate(stats: SessionStats): number {
  return stats.toolCalls === 0 ? 0 : stats.toolCallSuccesses / stats.toolCalls;
}

export function toolCallFailureRate(stats: SessionStats): number {
  return stats.toolCalls === 0 ? 0 : stats.toolCallFailures / stats.toolCalls;
}
