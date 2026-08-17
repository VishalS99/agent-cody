export const COMPACTION_RUBRIC_PROMPT = `You are deciding whether to compress the agent's conversation history into a summary that REPLACES the full history above. After compression, execution continues from only [system instructions, task request, live goal/state, assistant summary]. Compression is irreversible: anything not preserved in the summary is gone.

Compression is safe ONLY when ALL FOUR conditions hold:
(C1) the latest tool-call round or reasoning unit is closed, not mid-operation;
(C2) the essential trajectory can be reduced to 3–5 concrete, evidence-backed facts plus the active continuation state;
(C3) useful progress has occurred since the last compression;
(N1) the agent is NOT stuck in a repeated-failure or no-new-evidence loop.

Answer C1, C2, C3, and N1 honestly. Every Y answer requires verbatim evidence from the trajectory above; answers without evidence default to N.

C1 CLOSED-UNIT: The latest assistant/tool round has completed. Any file edit, command, test, or external action is finished and its result is visible. The agent is not mid-edit, mid-command, mid-investigation, or holding an incomplete tool call. If Y, quote the closing evidence from the latest completed round. If N, quote the fragment showing the operation is still open.

C2 SUMMARIZABLE: You can preserve the trajectory's essential value in 3–5 numbered concrete facts, each with a verbatim citation from a tool result, file observation, test result, or user requirement. Facts may include files changed, verified findings, decisions, constraints, failures that prevent repeating work, or resolved subproblems. Also identify the current goal, current step, remaining steps, and unresolved risks that must continue after compression. Answer N if the value depends on many small intermediate observations, an active derivation, unverified edits, or dispersed negative results that would be unsafe to lose. If Y, list 3–5 facts with citations separated by \` | \`.

C3 PROGRESS: Since the most recent compression (or the start of the task if none), the agent has completed a verified action, obtained new evidence, changed a file, passed or failed a check, or refined the active subproblem. If Y, name that progress with evidence. If N, state that the trajectory has returned to the same state as the last compression.

N1 NOT_STUCK: The agent is not stuck. Answer N1=Y when at least 3 of the last 4 tool-call rounds produced no new evidence, repeated the same failed approach, or failed for the same reason. If fewer than 4 rounds exist, answer Y. If N1=N, name one distinct untried strategy or missing prerequisite. If N1=Y, name the latest concrete result or next action that can proceed.

Output exactly 4 lines, with no preamble or trailing text:
C1: Y/N -- <evidence>
C2: Y/N -- <facts and citations, or the class of information that would be lost>
C3: Y/N -- <evidence>
N1: Y/N -- <evidence>

Fire rule: return COMPRESS iff C1 = Y, C2 = Y, C3 = Y, and N1 = Y. Otherwise return CONTINUE.`;
