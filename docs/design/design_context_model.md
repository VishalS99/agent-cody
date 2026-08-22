# Context Model v2

## Objective

Keep agent context lean and compaction-friendly. Decouple the *storage format*
from the *API wire format* so tool outputs — the dominant token cost — can be
compressed in place without touching reasoning history.

## Design Principles

1. **Storage ≠ wire format.** Store lean with separated concerns. Materialize
   the full LLM-API payload (tool calls inside messages) only at call time. The
   materialized payload is ephemeral and never persisted.
2. **Tool outputs are first-class addressable.** They live in their own list
   with stable IDs so summaries/compression can mutate them in place.
3. **Messages are immutable reasoning history.** Agent + user turns plus refs.
   Never modified by compaction — only by pruning aged entries.
4. **Goal and mutable state are first-class fields.** Explicit, not buried in
   the system prompt.
5. **Keep state minimal.** Four flat fields. Anything the system can derive from
   `tool_actions_taken` lives in the tool log, not duplicated in state.

## Model

```
Context:
  system_prompt: str                  # agent's core instructions
  goal: str                            # the task objective (set once, rarely changes)
  state: dict                          # minimal mutable working memory (see below)

  messages[]                           # append-only reasoning + refs
                                       #   { role, content, tool_action_ref?: "ta-3" }

  available_tools[]                    # tool definitions exposed to the agent
                                       #   { name, description, parameters }

  tool_actions_taken[]                 # self-contained tool execution log
                                       #   { id, tool, args, response, summary,
                                       #     status, timestamp }

  action_steps[]                       # forward-looking plan for multi-step tasks
                                       #   { id, description, status, depends_on[] }
                                       # completed steps retained for audit trail
```

## State

Minimal, flat, deliberately small to avoid context bloat:

```
state:
  notes[]         # ordered working narrative, appended per turn
  decisions[]     # agent judgment calls the system cannot derive
  current_step    # index into action_steps[] (system-derived)
  files_read[]    # files the agent has read (system-derived)
```

### Who writes what

| Field          | Writer | How |
| -------------- | ------ | --- |
| `notes[]`      | Agent  | `update_state` appends a checkpoint entry each turn. |
| `decisions[]`  | Agent  | `update_state` appends judgment calls the system cannot infer. |
| `current_step` | System | Derived from `action_steps[].status` after agent marks completion. |
| `files_read[]` | System | Derived from `read`/`edit`/`write` calls in `tool_actions_taken`. Editing implies reading first, so one list covers both `files_touched` and `references`. |

### Notes structure

`notes[]` is a chronologically-ordered list, one entry per turn (or per notable
milestone). Array over string because:
- append-only per turn (no wholesale rewrite of a monolith every turn, no token churn)
- compaction is surgical: compress/prune old entries independently, keep recent raw
- each entry is a self-contained checkpoint ("done X, next Y, concern Z")

## Context-Mutation Tools

The agent mutates the structured fields (`goal`, `action_steps`, `state`) via
tools exposed in `available_tools`. Nothing is edited by implicit text
instructions — a tool guarantees schema and validation. `messages` is *not*
mutable by these tools (it is the raw conversation record).

### `set_goal(goal, steps)`
Interpret the raw user prompt into a structured objective + linear plan. Called
once at task start; atomic so goal and plan appear together.

- `goal: str` — concise objective ("refactor helpers.py to eliminate syntax errors")
- `steps: [str]` — ordered linear steps toward the goal
- System: sets `context.goal`, populates `action_steps[]` with
  `{ id, description, status: pending, depends_on: null }`, sets `current_step = 0`
- Linear for now. DAG later via `depends_on[]` without breaking the schema.

```
user: "fix this file so syntax bugs don't come up"
agent -> set_goal(
    goal="Refactor helpers.py to eliminate syntax-error patterns and add a guard",
    steps=[
      "Read helpers.py and identify syntax-error-prone patterns",
      "Refactor risky constructs to safer equivalents",
      "Run tests / syntax check to verify",
      "Report changes"
    ])
```

### `update_state(notes?, decision?, step_completed?)`

Append-only checkpoint call, used at the end of each meaningful action/turn.

- `notes?` — string appended as a new `state.notes[]` entry ("done X; next Y; concern Z")
- `decision?` — string appended to `state.decisions[]` (judgment a later reader can't infer)
- `step_completed?` — int index into `action_steps[]`; system marks
  `action_steps[i].status = done` and advances `current_step` to the next pending step

System side-effects:
- rejects `step_completed` if out of `action_steps[]` bounds
- appends `files_read` from this turn's tool calls
- `current_step` walks the plan as steps complete

```
agent -> update_state(
    notes="Rewrote helpers.py guard clauses; api.py:42 still mismatched",
    decision="prefer guard clauses over nested conditionals",
    step_completed=2)
=> state.notes += [...];
   state.decisions += [...];
   state.current_step = 3
```

### Planned (future)

- `set_steps(steps)` — mid-task re-planning or appending steps without touching `goal`
- `revise_goal(goal)` — scope change mid-task (rare; new goal replaces old)
- DAG topology for `action_steps` via `depends_on[]`

## Why `tool_actions_taken` Owns the Record

Tool outputs are the dominant token cost and the primary compaction target.
Keeping the record self-contained in `tool_actions_taken` lets compaction mutate
tool output *content* (full → summary → prune) without touching `messages`.
The ID space (`ta-0`, `ta-1`, ...) stays stable, so `messages` refs
(`tool_action_ref: "ta-3"`) always resolve even after the underlying content
shrinks.

## Materialization (Storage → Wire Format)

API providers expect tool calls *inside* messages:

- **OpenAI**: `assistant` message with `tool_calls[]` + `tool` role responses
- **Anthropic**: `tool_use` / `tool_result` content blocks on messages

At model-call time, join `messages` with `tool_actions_taken` by ID to produce
the provider-format payload. This payload is **ephemeral** — built, sent to the
model, and discarded. It does not affect stored context.

```
materialize(context) -> messages_api_format
  for each message with tool_action_ref:
    resolve ref -> tool_actions_taken[id]
    inject tool_use + tool_result content blocks
  return provider-compatible messages[]
```

## Compaction Strategy

1. **Target**: entries in `tool_actions_taken` and `state.notes[]`,
   ordered oldest-first.
2. **Steps** (applied incrementally as context approaches budget):
   a. `tool_actions_taken`: replace `response` with `summary` if not already done.
   b. `tool_actions_taken`: drop raw `args` / `response`, keep `summary` + `status`.
   c. `state.notes[]`: compress old entries into a single earliest-entry summary.
   d. Prune entries fully if their `messages` ref has aged out.
3. **Never** mutate `messages[].content` reasoning text.
4. **Never** touch `state.decisions[]` — agent judgment is preserved.
5. **Never** compact `goal` or `action_steps` — the plan and objective are fixed context.