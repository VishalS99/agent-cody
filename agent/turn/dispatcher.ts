import type { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import { applyContextUpdate } from "../tools/context/manager.js";
import type { AgentContext, ToolDefinition, ToolResult, TurnHooks } from "../types.js";

function findToolDefinition(context: AgentContext, toolName: string): ToolDefinition | undefined {
  return context.available_tools?.find(t => t.function.name === toolName);
}

export async function dispatchToolCall(
  context: AgentContext,
  call: ChatCompletionMessageFunctionToolCall,
  hooks?: TurnHooks,
): Promise<ToolResult> {
  const tool = findToolDefinition(context, call.function.name);

  if (!tool) {
    return {
      tool_call_id: call.id,
      content: JSON.stringify({
        error: `Tool '${call.function.name}' not found`,
      }),
      isError: true,
    };
  }

  let rawParams: unknown;
  try {
    rawParams = JSON.parse(call.function.arguments);
  } catch {
    return {
      tool_call_id: call.id,
      content: JSON.stringify({
        error: "Invalid JSON tool arguments",
      }),
      isError: true,
    };
  }

  const parsedParams = tool.function.parameters.safeParse(rawParams);
  if (!parsedParams.success) {
    return {
      tool_call_id: call.id,
      content: JSON.stringify({
        error: `Invalid arguments: ${parsedParams.error.message}`,
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
        error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      }),
      isError: true,
    };
  }

  const completedIndex =
    result.contextUpdate?.type === "update_state" ? result.contextUpdate.step_completed : undefined;
  if (!result.isError && result.contextUpdate) {
    try {
      applyContextUpdate(context, result.contextUpdate);
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

  if (!result.isError && completedIndex !== undefined) {
    const completedStep = context.action_steps?.[completedIndex];
    const nextStep = context.action_steps?.[completedIndex + 1];
    if (completedStep) hooks?.onStepCompleted?.(completedStep, completedIndex, nextStep);
  }

  return result;
}

export { findToolDefinition };
