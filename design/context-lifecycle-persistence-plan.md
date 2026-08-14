# Context Lifecycle Persistence

## Context

The `goals` tool currently returns a `contextUpdate`, and `agent/agent.ts` applies it to the in-memory `AgentContext` through `applyContextUpdate`. `agent/loop.ts` creates one context and one `Agent` for its current run, but no plan-to-execution handoff or persistence API exists in the inspected repository. If execution creates a new agent/context, the goal, action steps, state, and plan evidence are lost because only the empty context shell is recreated.

The end state is an explicit host-owned context handoff: planning returns a complete context snapshot, execution hydrates its context from that snapshot, and the first execution request renders the preserved goal and steps. Do not infer context from displayed Markdown or parse assistant prose.

## Approach

### 1. Define a serializable context snapshot contract

Extend `agent/types.ts` with an `AgentContextSnapshot` containing the state that must cross a planning/execution boundary:

- `messages: Messages[]`
- `tool_actions_taken: ToolResult[]`
- `goal?: string`
- `action_steps?: ActionStep[]`
- `state?: ContextState`

Add these exact functions in `agent/tools/context/manager.ts` because that module already owns context mutation and no snapshot utility exists:

- `snapshotContext(context: AgentContext): AgentContextSnapshot`
- `hydrateContext(base: AgentContext, snapshot: AgentContextSnapshot): AgentContext`

`snapshotContext` must return a deep copy so later execution mutations cannot alter the planning snapshot. Normalize absent optional arrays to empty arrays in the snapshot. `hydrateContext` must preserve the host-created `system_prompt` and `available_tools`, then deep-copy the snapshot fields into the base context; it must not replace provider/tool configuration with planning-time values.

### 2. Expose the handoff at the agent boundary

Add `getContextSnapshot(): AgentContextSnapshot` to `agent/agent.ts`, delegating to `snapshotContext(this.agentContext)`. The planning host calls this only after the planning turn completes and the `goals` context update has been applied.

Add a host-facing constructor/helper in `agent/loop.ts` or a new context lifecycle module (no equivalent exists) that creates the normal base context and hydrates it from an optional `AgentContextSnapshot`. Keep `buildAgentContext` responsible for static prompt/tools only; it must not silently discard a supplied snapshot.

### 3. Define the plan-to-execution transition

At the plan-mode boundary:

1. Run the planning `Agent` with the existing prompt and tools.
2. Require a non-empty `snapshot.goal` and at least one `snapshot.action_steps` entry before execution can start. If absent, return a host error and do not start execution.
3. Capture `agent.getContextSnapshot()` after the final planning tool result has been applied.

At execution startup:

1. Create the base context with the execution system prompt and available tools.
2. Call `hydrateContext(baseContext, planSnapshot)`.
3. Construct the execution `Agent` with the hydrated context.
4. Do not append a duplicate planning user message or reconstruct the plan from the displayed response.

If plan and execution are later represented by the same `Agent`, reuse the same `AgentContext` directly; the snapshot/hydration path is required for separate agent instances.

### 4. Preserve dynamic prompt injection

Keep `buildContextSnapshot` and `buildRequestSystemPrompt` in `agent/prompt.ts`. `Agent.toLLMRequest()` must render the hydrated context on every request, so execution receives:

- the preserved goal
- action steps and statuses
- current step
- notes, decisions, and files read

The canonical source is the hydrated `AgentContext`; assistant Markdown announcements remain presentation only and never mutate context. Keep the prompt-level rule that repository reviews/plans may perform read-only discovery before calling `goals`, then must call `goals` before presenting the final plan.

### 5. Keep context updates authoritative

Retain the existing `ContextUpdate` flow:

- `agent/tools/context/goals.ts` validates and returns `contextUpdate: { type: "set_goal", goal, steps }`.
- `agent/agent.ts` applies successful updates through `applyContextUpdate`.
- Snapshot capture happens only after dispatch returns successfully.

Do not add a goal-read tool, parse `## Goal` headings, or force a provider `toolChoice`; persistence at the mode boundary is the required fix.

## Critical files & anchors

- `agent/types.ts:7-47` — `AgentContext`, `ActionStep`, `ContextUpdate`, and `ToolResult`; add the snapshot contract here.
- `agent/tools/context/manager.ts:8-96` — existing mutation manager; add deep-copy snapshot/hydration utilities.
- `agent/agent.ts:41-174, 196-279` — turn lifecycle, context update application, and new snapshot getter.
- `agent/loop.ts:19-45` — context construction and `Agent` creation; add optional snapshot hydration at the host boundary.
- `agent/prompt.ts:63-86` — dynamic snapshot rendering used by execution requests.

## Verification

1. Add a focused context lifecycle test or executable smoke check:
   - Apply `{ type: "set_goal", goal: "Review security", steps: ["Inspect files", "Prioritize findings"] }` to a context.
   - Snapshot it, hydrate a fresh base context, and assert the goal, both steps, statuses, and state arrays are preserved while the base system prompt/tools remain unchanged.
2. Verify the first hydrated execution request through `buildRequestSystemPrompt` contains `Goal: Review security`, the current step, and both action steps.
3. Verify later execution mutation of the hydrated context does not mutate the original planning snapshot.
4. Verify execution startup rejects a snapshot with no goal or no action steps instead of silently starting with an empty plan.
5. Run from the repository root:
   - `bun run typecheck`
   - the focused lifecycle test/smoke command.
   - If the existing `config/env.ts:17` syntax error remains, report that full typecheck blocker separately and use the focused module build/smoke check as interim evidence; do not change unrelated configuration as part of this context handoff.

## Assumptions & contingencies

- The host owns persistence and mode transitions; `Agent` owns only its mutable context and exposes a snapshot.
- The inspected repository currently has a single `runLoop` and no separate plan/execution entrypoint. When the mode layer is introduced, it must call the snapshot/hydration API at that boundary rather than constructing an empty context for execution.
- Full conversation messages and tool records cross the boundary because planning evidence may be needed during execution; static system prompt and tool definitions are always rebuilt by the execution host.
