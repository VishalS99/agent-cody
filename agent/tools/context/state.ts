/**
 * We need a state management tool
 * The llm will make update
 *  1. decisions
 *  2. provide some notes
 *  3. curreent step(llm or maybe we update it)
 *  4. files read - we update it
 *
 */
import * as z from "zod";
import type { ToolDefinition, ToolResult } from "../../types.js";

export const stateSchema = z
  .object({
    notes: z.string().trim().min(1).max(300).optional().describe("One concise progress note to append to state."),
    decision: z.string().trim().min(1).max(300).optional().describe("One judgment call to append to state."),
    step_completed: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Zero-based index of the completed action step."),
  })
  .refine(value => value.notes !== undefined || value.decision !== undefined || value.step_completed !== undefined, {
    message: "At least one state field must be provided",
  });

export const stateResultSchema = z.object({
  error: z.string().optional().describe("Human-readable validation error."),
  issues: z
    .array(
      z.object({
        field: z
          .enum(["state", "notes", "decision", "step_completed"])
          .describe("The input field containing the validation problem."),
        reason: z.string().describe("Why the value failed validation."),
      }),
    )
    .optional()
    .describe("Validation issues found in the state update."),
  updated_notes: z.string().optional().describe("Normalized note accepted for state."),
  updated_decision: z.string().optional().describe("Normalized decision accepted for state."),
  step_completed: z.number().int().nonnegative().optional(),
});

export type State = z.infer<typeof stateSchema>;
export type StateResult = z.infer<typeof stateResultSchema>;

export type StateValidationIssue = {
  field: "state" | "notes" | "decision" | "step_completed";
  reason: string;
};

export type StateValidationResult =
  | { ok: false; issues: StateValidationIssue[] }
  | {
      ok: true;
      notes?: string;
      decision?: string;
      step_completed?: number;
    };

export const stateToolDefinition: ToolDefinition<typeof stateSchema> = {
  type: "function",
  function: {
    name: "state",
    description: "Append a concise progress note or decision and optionally mark the current action step complete.",
    label: "state",
    emoji: "📝",
    parameters: stateSchema,
    execute: async (toolId: string, params: State): Promise<ToolResult> => {
      const validation = validateState(params);
      if (!validation.ok) {
        const result: StateResult = {
          error: "State update validation failed",
          issues: validation.issues,
        };
        return {
          tool_call_id: toolId,
          content: JSON.stringify(result),
          isError: true,
        };
      }

      return {
        tool_call_id: toolId,
        content: JSON.stringify({ status: "state_updated" }),
        isError: false,
        contextUpdate: {
          type: "update_state",
          ...(validation.notes !== undefined ? { notes: validation.notes } : {}),
          ...(validation.decision !== undefined ? { decision: validation.decision } : {}),
          ...(validation.step_completed !== undefined ? { step_completed: validation.step_completed } : {}),
        },
      };
    },
  },
};

export function validateState(params: State): StateValidationResult {
  const issues: StateValidationIssue[] = [];
  const notes = params.notes === undefined ? undefined : normalize(params.notes);
  const decision = params.decision === undefined ? undefined : normalize(params.decision);

  if (params.notes !== undefined) {
    if (!notes) {
      issues.push({
        field: "notes",
        reason: "Note cannot be empty after normalization",
      });
    } else if (hasControlCharacters(notes)) {
      issues.push({
        field: "notes",
        reason: "Control characters are not allowed",
      });
    }
  }

  if (params.decision !== undefined) {
    if (!decision) {
      issues.push({
        field: "decision",
        reason: "Decision cannot be empty after normalization",
      });
    } else if (hasControlCharacters(decision)) {
      issues.push({
        field: "decision",
        reason: "Control characters are not allowed",
      });
    }
  }
  if (notes === undefined && decision === undefined && params.step_completed === undefined) {
    issues.push({
      field: "state",
      reason: "At least one state field must be provided",
    });
  }

  if (params.step_completed !== undefined && (!Number.isInteger(params.step_completed) || params.step_completed < 0)) {
    issues.push({
      field: "step_completed",
      reason: "Completed step must be a nonnegative integer",
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    ...(notes !== undefined ? { notes } : {}),
    ...(decision !== undefined ? { decision } : {}),
    ...(params.step_completed !== undefined ? { step_completed: params.step_completed } : {}),
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}
