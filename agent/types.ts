import type { Messages, ToolCall } from "../schemas/messages.js";
import type { SessionStats } from "./stats.js";
import type * as z from "zod";
// Agent orchestration layer: owns the tool-call/tool-definition types and
// the conversation context. Imports direction-only from schemas/.

export interface AgentContext {
  system_prompt: string;
  messages: Messages[];
  available_tools?: ToolDefinition<z.ZodType>[];
  tool_actions_taken?: ToolAction[];
  action_steps?: ActionStep[];
  goal?: string;
  state?: ContextState;
}

export interface ContextState {
  notes: string[];
  decisions: string[];
  current_step: number;
  files_read: string[];
}

export interface ActionStep {
  action: string;
  status: "pending" | "current" | "completed";
}

export type ContextUpdate =
  | {
      type: "set_goal";
      goal: string;
      steps: string[];
    }
  | {
      type: "update_state";
      notes?: string;
      decision?: string;
      step_completed?: number;
      files_read?: string;
    };

export interface ToolResult {
  tool_call_id: string;
  content: string;
  isError?: boolean;
  contextUpdate?: ContextUpdate;
}

export interface ToolAction extends ToolResult {
  tool: string;
  arguments: string;
  timestamp: number;
}

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  type: "function";
  function: {
    name: string;
    description: string;
    label: string;
    emoji: string;
    parameters: TSchema;
    execute(toolId: string, params: z.output<TSchema>): Promise<ToolResult>;
  };
}

export interface TurnHooks {
  onDelta?: (text: string) => void;
  onToolCallStart?: (call: ToolCall) => void;
  onToolCallResult?: (result: ToolResult) => void;
  onStepCompleted?: (step: ActionStep, index: number, nextStep?: ActionStep) => void;
  onUsage?: (usage: SessionStats) => void;
  onTurnEnd?: (reply: string, toolCalls: number) => void;
}

export interface TurnSummary {
  reply: string;
  toolCalls: number;
  durationMs: number;
}
