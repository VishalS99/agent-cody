# Context Compaction Plan

## Objective

Implement adaptive context compaction for long-running agents using the
[SELFCOMPACT paper](https://arxiv.org/pdf/2606.23525v2), with a deterministic
80% context-budget fallback.

Compaction must reduce stale transcript history without losing the active task:
`goal`, `action_steps`, and `state` survive every compaction.

## Core Strategy

```text
normal tool-call rounds
  -> every N rounds: run rubric probe
  -> COMPRESS or CONTINUE
  -> COMPRESS: request summary and replace old transcript

context reaches 80% effective budget
  -> skip rubric
  -> force summary directly
  -> replace old transcript
```

The rubric is for adaptive timing. The 80% path is defensive overflow
prevention and never asks the model whether to continue.

## Rubric Probe (Harness-Initiated)

Compaction is not a tool the agent chooses to call. The harness schedules the
rubric probe after every `N` completed tool-call rounds, and the model answers
the rubric with `COMPRESS` or `CONTINUE`. The agent and harness together decide
compaction: the harness owns timing, probing, and transcript replacement; the
model owns the adaptivity judgment.

The probe's internal rubric and summary requests are not loop iterations, do
not increment the tool-round counter, and are not persisted as ordinary
messages or tool actions. No `compact_context` tool is exposed to the agent.

## Context Units

A **tool-call round** is one model iteration that emits one or more tool calls
and receives their results. Count rounds, not individual tools.

- Increment the round counter after a completed tool-call round.
- Probe at every `N` rounds.
- Reset the counter after successful compaction.
- A final assistant response without tool calls does not trigger a probe.

## Scheduled Rubric Compaction

At each scheduled checkpoint, issue a temporary user-role rubric request.
The rubric request and its response are not persisted in `messages`.

The rubric must return exactly one decision:

```text
COMPRESS
```

or:

```text
CONTINUE
```

The rubric should evaluate:

- Whether a subtask or verified reasoning unit has resolved
- Whether the trajectory is converging
- Whether the agent is at a safe compaction boundary
- Whether it is currently mid-derivation, mid-search, or stuck
- Whether a summary can preserve the information needed to continue

Normal workspace tools must be disabled during the rubric request.

Prefer constructing the rubric request from a temporary message copy. If the
rubric prompt and response are appended to a working array, remove both before
continuing; neither belongs in persistent `messages` or `tool_actions_taken`.

### `CONTINUE`

- Discard the temporary rubric request and response.
- Leave persistent `messages` and `tool_actions_taken` unchanged.
- Continue the current task.

### `COMPRESS`

- Discard the rubric request and response.
- Issue the summary request using the current transcript.
- Do not persist the summary prompt itself.
- Keep only the generated summary as the compacted transcript content.

## Forced 80% Compaction

The harness measures the active context against the model's effective budget:

```text
effective_budget = model_context_window - reserved_output_tokens
threshold = effective_budget * 0.80
```

When the active context reaches the threshold:

- Skip the rubric entirely.
- Force the summary request directly.
- Do not allow a `CONTINUE` decision.
- Trigger only after the current tool-call round completes.
- Preserve the active goal, steps, and state.

The threshold path has higher priority than scheduled rubric behavior:

```text
forced 80% compaction > scheduled rubric probe > normal continuation
```

## Summary Request

The summary prompt asks the model to produce a concise continuation state,
not a user-facing answer.

The summary must preserve:

- Original user requirements and constraints
- Current goal
- Completed, current, and remaining action steps
- Current step index
- Important decisions
- Verified findings and evidence
- Files read or changed
- Outstanding errors, risks, and blockers
- Work that must happen next
- No unsupported completion claims

Normal workspace tools must be disabled during summary generation.

## Task Request Anchor

The exact task request must be captured explicitly; it must not be inferred
from `messages[0]`, because a session may begin with conversational messages
such as "Hi".

At the successful `set_goal` transition, capture the latest user message that
preceded the goal call:

```ts
context.task_request = latestUserMessage.content
```

`task_request` is host-owned, immutable for the active task, and survives
compaction. If a new task begins and a new goal is initialized, replace the
task anchor or create a new task context.

`goal` and `action_steps` are structured execution state, not a lossless
replacement for the user's request. The anchor preserves exact constraints,
acceptance criteria, paths, examples, and output requirements.

After compaction, reconstruct the task context from:

```text
user: task_request
assistant: compacted summary
```

## Transcript Replacement

Compaction follows the paper's `original task + summary` structure.

After summary generation:

1. Reconstruct one root user message from `context.task_request`.
2. Remove old assistant reasoning messages.
3. Remove old assistant `tool_calls` messages.
4. Remove matching old `tool` messages.
5. Remove corresponding old `tool_actions_taken` records.
6. Append the generated summary as an `assistant` message.
7. Keep `goal`, `action_steps`, and `state` unchanged.
8. Reset the tool-round counter.

Do not insert the summary as a fake `tool` message. It is not a tool result and
must not require a `tool_call_id`.

The original task anchor must survive. Removing literally every message would
remove the user's request and violate the paper's `x + summary` structure.

Compaction must remove complete tool-call rounds. Never leave an assistant
`tool_calls[]` message without all of its matching tool responses.

## Storage and Hydration

`tool_actions_taken` remains the raw action history. It does not need a per-action
`summary` field.

Stored tool messages remain lean:

```ts
{
  role: "tool",
  content: "",
  tool_call_id: action.tool_call_id,
  name: action.tool,
}
```

Before a normal model request, hydration resolves `tool_call_id` against
`tool_actions_taken` and fills the outgoing tool message content.

Compaction must remove the stored message and action together. A missing action
reference is an invariant violation and hydration should fail clearly.

## Context Size Accounting

Maintain separate metrics:

```ts
cumulativeInputTokens  // total tokens used for billing and observability
currentContextTokens   // size of the active context
```

Do not derive the new context size by subtracting or incrementing old values.
After transcript replacement:

```text
new system snapshot + root task + summary
  -> estimate or tokenize
  -> set currentContextTokens
```

The summary request's input usage must not become the new active context size;
that request still contains the pre-compaction transcript. Reconcile the
estimate with the next normal model response's actual prompt usage.

## State Preservation

Compaction never removes or rewrites:

- `context.goal`
- `context.action_steps`
- `state.notes[]`
- `state.decisions[]`
- `state.current_step`
- `state.files_read[]`

The dynamic system-context snapshot continues to expose these fields after
compaction.

## Implementation (on `Agent`)

The compaction controller is implemented directly on the `Agent`, not as a
separate manager class. It is responsible for:

- Counting tool-call rounds (`toolRoundCount`)
- Measuring the active context
- Selecting scheduled versus forced compaction
- Issuing rubric requests
- Issuing summary requests
- Removing transient probe and summary messages
- Replacing transcript history
- Removing stale tool actions
- Resetting counters and recalculating context size

After each completed tool-call round:

```text
record tool results
apply context updates
update round count
measure context

if threshold >= 80%:
    force summary
else if round count % N == 0:
    run rubric
```

Internal rubric and summary requests must bypass the normal tool loop and must
not be persisted as ordinary conversation turns.

## Failure Handling

- Invalid rubric output: treat as `CONTINUE`, log the failure, and preserve context.
- Summary request failure: preserve the original context and continue normally.
- Missing tool action during hydration: fail loudly; do not send a reference as
  tool content.
- Summary generation must never mutate goal, steps, or state directly.
- If the context is already near the provider limit, use a short summary prompt
  and a bounded summary output budget.

## Acceptance Criteria
- The harness schedules the rubric probe; the model answers `COMPRESS` or `CONTINUE`.

- `CONTINUE` leaves persistent context unchanged.
- Scheduled `COMPRESS` removes old transcript and tool actions.
- Forced 80% compaction bypasses the rubric.
- Rubric and summary prompts/responses are not retained as normal history.
- The root user task and one generated summary remain after compaction.
- No dangling assistant tool calls or tool-message references remain.
- Goal, action steps, notes, decisions, current step, and files read survive.
- `currentContextTokens` is recalculated from the rebuilt context.
- The agent resumes from the existing current step.

## Verification Plan

Add focused tests for:

1. Rubric `CONTINUE` cleanup and unchanged context.
2. Rubric `COMPRESS` transcript replacement.
3. Forced 80% compaction without a rubric call.
4. Probe and summary prompt removal.
5. Complete tool-round removal and reference integrity.
6. State and goal preservation.
7. Context-size reset after compaction.
8. Failed rubric and summary requests.
9. Hydration after compaction.
10. Resumption from a nonzero `current_step`.
