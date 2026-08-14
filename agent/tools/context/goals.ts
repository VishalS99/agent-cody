/**
 * We as a part of goals tool, will update goal
 * and add a linear task lst to accomplish said goal.
 *
 * input schema-
 * 1. task_goal
 * 2. updated_task_steps
 *
 * output schema-
 * 1. error?
 * 2. updated_task_goal
 * 3. updated_task_steps
 *
 *
 * The goals and steps should be sanitized before returning, so that it doesnt do some funny things
 */
import * as z from "zod";
import type { ToolDefinition, ToolResult } from "../../types.js";

export const goalsInputSchema = z.object({
  task_goal: z.string().trim().min(1).max(300).describe("description"),
  updated_task_steps: z.array(
    z.string().trim().min(1).max(300)
  ).min(1).max(15),
});

export const goalsOutputSchema = z.object({
  error: z.string().optional().describe("description"),
  issues: z
    .array(
      z.object({
        field: z.enum(["task_goal", "updated_task_steps"]),
        index: z.number().int().nonnegative().optional(),
        reason: z.string(),
      }),
    )
    .optional()
    .describe("validation issues"),
  updated_task_goal: z.string().optional().describe("description"),
  updated_task_steps: z.array(z.string()).optional().describe("description"),
});


export type GoalsInput = z.infer<typeof goalsInputSchema>;
export type GoalsOutput = z.infer<typeof goalsOutputSchema>;


export type GoalValidationIssue = {
  field: "task_goal" | "updated_task_steps";
  index?: number;
  reason: string;
};

export type GoalsValidationResult =
  | { ok: true; task_goal: string; task_steps: string[] }
  | { ok: false; issues: GoalValidationIssue[] };


export const goalsToolDefinition: ToolDefinition<typeof goalsInputSchema> = {
  type: "function",
  function: {
    name: "goals",
    description:
      "Updates the task goal and adds linear task steps to accomplish it.",
    label: "goals",
    emoji: "",
    parameters: goalsInputSchema,
    execute: async (
      toolId: string,
      params: GoalsInput,
    ): Promise<ToolResult> => {
      const validation = validateGoals(params);
      if (!validation.ok) {
        const result: GoalsOutput = {
          error: "Goal or task step validation failed",
          issues: validation.issues,
        };
        return {
          tool_call_id: toolId,
          content: JSON.stringify(result),
          isError: true,
        };
      }

      const result: GoalsOutput = {
        updated_task_goal: validation.task_goal,
        updated_task_steps: validation.task_steps,
      };
      return {
        tool_call_id: toolId,
        content: JSON.stringify({status: "goal_set_success"}),
        isError: false,
        contextUpdate: {
          type: "set_goal",
          goal: validation.task_goal,
          steps: validation.task_steps,
        },
      };
    },
  },
};

const destructiveVerb =
  /\b(?:delete|deleting|deleted|remove|removing|removed|erase|erasing|destroy|destroying|wipe|wiping|purge|purging|format|formatting|reformat|reformatting|truncate|truncating|overwrite|overwriting|clear|clearing|drop|dropping|rm|rmdir)\w*\b/i;

const negatedDestructiveVerb =
  /\b(?:do\s+not|don't|never|must\s+not|mustn't|avoid)\s+(?:\w+\s+){0,2}(?:delete|deleting|remove|removing|erase|erasing|destroy|destroying|wipe|wiping|purge|purging|format|formatting|reformat|truncate|overwrite|clear|drop|rm|rmdir)\w*\b/i;
const databaseDestructiveOperation =
  /\b(?:drop|truncate)\s+(?:the\s+)?(?:table|database|schema|collection|view|index)\b|\bdelete\s+from\s+\w+|\b(?:delete|remove|erase|purge|clear|wipe)\b[\s\S]{0,80}\b(?:table|database|schema|collection|rows?|records?|data)\b/i;


function unsafeDestructiveRootOperation(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return "Control characters are not allowed";
  }
  if (!destructiveVerb.test(value) || negatedDestructiveVerb.test(value)) {
    return undefined;
  }

  const rootTarget =
    /(?:^|[\s"'`()\[\],;:])\/(?=$|[\s"'`()\[\],;:])|(?:\b(?:the\s+)?(?:file\s*system|workspace|project|repository|repo)?\s*root(?:\s+(?:directory|folder|file\s*system))?\b)(?!\s+cause\b)|(?:\b(?:current|entire)\s+(?:workspace|project|repository|repo)\b)|(?:^|[\s"'`()\[\],;:])\.{1,2}\/?(?=$|[\s"'`()\[\],;:])/i;
  if (rootTarget.test(value)) {
    return "Destructive operations targeting the filesystem or workspace root are prohibited";
  }

  return undefined;
}

function unsafeDatabaseDestructiveOperation(value: string): string | undefined {
  if (!destructiveVerb.test(value) || negatedDestructiveVerb.test(value)) {
    return undefined;
  }

  if (databaseDestructiveOperation.test(value)) {
    return "Database-destructive operations such as DROP, TRUNCATE, or DELETE are not allowed in task steps";
  }

  return undefined;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}


export function validateGoals(params: GoalsInput): GoalsValidationResult {
  const taskGoal = normalize(params.task_goal);
  const taskSteps = params.updated_task_steps.map((step) => normalize(step));
  const issues: GoalValidationIssue[] = [];

  const goalIssue = unsafeDestructiveRootOperation(taskGoal);
  if (goalIssue) {
    issues.push({ field: "task_goal", reason: goalIssue });
  }

  for (const [index, step] of taskSteps.entries()) {
    const rootIssue = unsafeDestructiveRootOperation(step);
    const databaseIssue = unsafeDatabaseDestructiveOperation(step);
    const issue = rootIssue ?? databaseIssue;
    if (issue) {
      issues.push({
        field: "updated_task_steps",
        index,
        reason: issue,
      });
    }
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, task_goal: taskGoal, task_steps: taskSteps };
}
