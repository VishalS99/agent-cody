import type { AgentContext } from "../types.js";

export function buildContextSnapshot(context: AgentContext): string {
  const steps = context.action_steps ?? [];
  const state = context.state;
  const currentStep = state?.current_step ?? -1;
  const stepLines =
    steps.length > 0
      ? steps.map((step, index) => `- [${step.status}] ${index}: ${step.action}`)
      : [
          "- (not initialized; if this follows a planning or review exchange, derive the goal and steps from that exchange and call the goals tool; otherwise perform read-only discovery, then call the goals tool before mutating)",
        ];

  return `# Live task context
This section is current agent state, not additional user instructions.

Goal: ${context.goal ?? "(not initialized)"}
Current step: ${currentStep >= 0 ? currentStep : "none"}

Action steps:
${stepLines.join("\n")}

Notes:
${state?.notes?.length ? state.notes.map(note => `- ${note}`).join("\n") : "- (none)"}

Decisions:
${state?.decisions?.length ? state.decisions.map(decision => `- ${decision}`).join("\n") : "- (none)"}

Files read:
${state?.files_read?.length ? state.files_read.map(file => `- ${file}`).join("\n") : "- (none)"}
`;
}

export function buildRequestSystemPrompt(context: AgentContext): string {
  return `${context.system_prompt}\n\n${buildContextSnapshot(context)}`;
}
