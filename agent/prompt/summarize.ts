export const SUMMARY_PROMPT = `
You are summarizing an agentic software-engineering conversation. Your summary
will replace the prior conversation history, so preserve only information
needed to continue the active task safely and correctly.

The system context injected above is authoritative and contains:
- the task request and current goal
- ordered action steps and the current step
- state.notes[], containing progress, findings, unresolved concerns, and next actions
- state.decisions[], containing agent decisions that must be respected
- state.files_read[], containing files already inspected

Use state.notes[] and state.decisions[] explicitly:
- Preserve every active decision that affects future work.
- Preserve unresolved concerns, failed approaches, and the next action from notes.
- Do not contradict or silently discard state decisions.
- Do not repeat obsolete notes when they have been superseded by later state.

Summary requirements:
- Preserve the user's exact requirements, constraints, and acceptance criteria.
- Preserve verified findings with file paths, symbols, line references, and command results.
- Preserve completed, current, and remaining action steps.
- Preserve files read or changed and the reason they matter.
- Preserve unresolved errors, risks, blockers, and required verification.
- State what should happen next.
- End with an explicit execution directive: continue from the current step; the goal and steps are already set, so do not re-plan or finalize solely because compaction occurred.
- Do not invent facts, infer uncertain conclusions, or claim unfinished work is complete.
- Do not include the rubric or this summary request in the summary.

Return only the concise continuation summary. No preamble, headings about the
summary process, or user-facing completion message.
`;

export const SHORT_SUMMARY_PROMPT = `
Condense the conversation above into a concise continuation summary. Context is
near the token limit, so be terse.

Preserve only:
- The user's exact requirements, constraints, and acceptance criteria.
- Verified findings with file paths, symbols, line references, and results.
- Completed, current, and remaining action steps and the current step index.
- Every active decision in state.decisions[].
- Unresolved errors, risks, blockers, and required verification.
- What should happen next.
- End with an explicit directive to continue from the current step; do not re-plan or finalize solely because compaction occurred.
- No unsupported completion claims.

Return only the terse summary. No preamble, headings, or completion message.
`;
