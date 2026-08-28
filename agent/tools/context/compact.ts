import type OpenAI from "openai";
import { config } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { type ILLMClient, LLMClient } from "../../../llm/client.js";
import { toLLMRequest } from "../../agent.js";
import { COMPACTION_RUBRIC_PROMPT } from "../../prompt/rubric.js";
import { SHORT_SUMMARY_PROMPT, SUMMARY_PROMPT } from "../../prompt/summarize.js";
import type { InternalUsage } from "../../stats.js";
import type { AgentContext } from "../../types.js";
import { buildLeanContext } from "../../context/clone.js";

export type CompactContextResult = {
  context: AgentContext;
  status: "COMPRESS" | "CONTINUE";
  error?: string;
  usage?: InternalUsage;
};

export async function compactContext(
  agentContext: AgentContext,
  client?: ILLMClient,
  nearLimit = false,
): Promise<CompactContextResult> {
  const context = buildLeanContext(agentContext);
  const compressClient = client ?? new LLMClient("openai-completions", config);
  const usage: InternalUsage = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
  const rubricStarted = performance.now();
  let rubricResponse: OpenAI.ChatCompletion;
  try {
    context.messages.push({
      role: "user",
      content: COMPACTION_RUBRIC_PROMPT,
    });
    const rubricRequest = toLLMRequest(context, true);
    rubricResponse = await compressClient.sendRequest(rubricRequest);
    usage.inputTokens = rubricResponse.usage?.prompt_tokens ?? 0;
    usage.outputTokens = rubricResponse.usage?.completion_tokens ?? 0;
    usage.durationMs = Math.round(performance.now() - rubricStarted);
  } catch (error) {
    logger.warn(
      { event: "rubric_request_failed", error: error instanceof Error ? error.message : String(error) },
      "Compaction rubric request failed",
    );
    return {
      context: agentContext,
      status: "CONTINUE",
      error: `rubric request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    context.messages.pop();
  }
  const rubricContent = rubricResponse.choices[0]?.message.content;
  if (typeof rubricContent !== "string" || rubricContent.trim() === "") {
    logger.warn(
      { event: "rubric_invalid_output", reason: "empty or missing content" },
      "Compaction rubric returned no decision",
    );
    return { context, status: "CONTINUE", usage };
  }
  let parsedDecision: unknown;
  try {
    parsedDecision = JSON.parse(rubricContent);
  } catch {
    logger.warn(
      { event: "rubric_invalid_output", reason: "not valid JSON" },
      "Compaction rubric returned unparseable output",
    );
    return { context, status: "CONTINUE", usage };
  }

  if (!isRubricDecision(parsedDecision) || parsedDecision.response === "CONTINUE") {
    if (!isRubricDecision(parsedDecision)) {
      logger.warn(
        { event: "rubric_invalid_output", reason: "unexpected decision shape" },
        "Compaction rubric returned invalid decision",
      );
    }
    return { context, status: "CONTINUE", usage };
  }

  const taskRequest = context.task_request;
  if (typeof taskRequest !== "string" || taskRequest.trim() === "") {
    return { context: agentContext, status: "CONTINUE", error: "task_request is missing", usage };
  }

  // summarize
  const summary = await requestSummary(context, compressClient, nearLimit);
  if (!summary.ok) {
    return { context: agentContext, status: "CONTINUE", error: summary.error, usage };
  }
  usage.inputTokens += summary.usage.inputTokens;
  usage.outputTokens += summary.usage.outputTokens;
  usage.durationMs += summary.usage.durationMs;

  context.messages = [{ role: "user", content: taskRequest }];

  if (context.tool_actions_taken) context.tool_actions_taken = [];

  context.messages.push({
    role: "assistant",
    content: summary.content,
  });

  return {
    status: "COMPRESS",
    context: { ...context },
    usage,
  };
}

export type SummaryResult = { ok: true; content: string; usage: InternalUsage } | { ok: false; error: string };

export async function requestSummary(
  context: AgentContext,
  client?: ILLMClient,
  nearLimit = false,
): Promise<SummaryResult> {
  if (client === undefined) client = new LLMClient("openai-completions", config);
  const summaryStarted = performance.now();
  let response: OpenAI.ChatCompletion;
  try {
    context.messages.push({
      role: "user",
      content: nearLimit ? SHORT_SUMMARY_PROMPT : SUMMARY_PROMPT,
    });
    response = await client.sendRequest(toLLMRequest(context, true));
  } catch (error) {
    logger.warn(
      { event: "summary_request_failed", error: error instanceof Error ? error.message : String(error) },
      "Compaction summary request failed",
    );
    return {
      ok: false,
      error: `summary request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    context.messages.pop();
  }
  const content = response.choices[0]?.message.content;
  if (typeof content !== "string" || content.trim() === "") {
    logger.warn(
      { event: "summary_invalid_output", reason: "empty or missing content" },
      "Compaction summary returned no content",
    );
    return { ok: false, error: "summary content is empty" };
  }
  return {
    ok: true,
    content,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      durationMs: Math.round(performance.now() - summaryStarted),
    },
  };
}

function isRubricDecision(value: unknown): value is { response: "COMPRESS" | "CONTINUE" } {
  if (typeof value !== "object" || value === null || !("response" in value)) return false;
  return value.response === "COMPRESS" || value.response === "CONTINUE";
}

export { buildLeanContext } from "../../context/clone.js";
