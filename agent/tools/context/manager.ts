import type { ActionStep, AgentContext, ContextState, ContextUpdate } from "../../types.js";

export function applyContextUpdate(context: AgentContext, update: ContextUpdate): void {
  switch (update.type) {
    case "set_goal":
      applyGoalUpdate(context, update.goal, update.steps);
      return;
    case "update_state":
      applyStateUpdate(context, update);
      return;
  }
}

function applyGoalUpdate(context: AgentContext, goal: string, steps: string[]): void {
  context.goal = goal;
  context.action_steps = steps.map(
    (action, index): ActionStep => ({
      action,
      status: index === 0 ? "current" : "pending",
    }),
  );

  const state = ensureState(context);
  state.current_step = steps.length > 0 ? 0 : -1;

  const latestRequest = latestUserRequest(context);
  if (latestRequest !== undefined) {
    context.task_request = latestRequest;
  }
}

function latestUserRequest(context: AgentContext): string | undefined {
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index];
    if (message?.role === "user" && message.content.trim() !== "") {
      return message.content;
    }
  }
  return undefined;
}

function applyStateUpdate(context: AgentContext, update: Extract<ContextUpdate, { type: "update_state" }>): void {
  const state = ensureState(context);

  if (update.notes?.trim()) {
    state.notes.push(update.notes.trim());
  }
  if (update.decision?.trim()) {
    state.decisions.push(update.decision.trim());
  }

  if (update.files_read?.trim()) {
    state.files_read.push(update.files_read.trim());
  }

  if (update.step_completed === undefined) {
    return;
  }

  const steps = context.action_steps ?? [];
  const completedIndex = update.step_completed;
  if (!Number.isInteger(completedIndex) || completedIndex < 0 || completedIndex >= steps.length) {
    throw new Error(`Invalid completed step index: ${completedIndex}`);
  }
  if (state.current_step !== completedIndex) {
    throw new Error(`Step ${completedIndex} is not current; expected ${state.current_step}`);
  }

  const completedStep = steps[completedIndex];
  if (!completedStep) {
    throw new Error(`Invalid completed step index: ${completedIndex}`);
  }
  completedStep.status = "completed";

  const nextIndex = completedIndex + 1;
  if (nextIndex < steps.length) {
    const nextStep = steps[nextIndex];
    if (!nextStep) {
      throw new Error(`Invalid next step index: ${nextIndex}`);
    }
    nextStep.status = "current";
    state.current_step = nextIndex;
  } else {
    state.current_step = -1;
  }
}

function ensureState(context: AgentContext): ContextState {
  context.state ??= {
    notes: [],
    decisions: [],
    current_step: -1,
    files_read: [],
  };
  return context.state;
}
