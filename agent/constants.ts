export const MAX_TOOL_ITERATIONS = 100;
export const COMPACTION_TURN_THRESHOLD = 20;
export const COMPACTION_NEAR_LIMIT_RATIO = 0.9;
export const CONTEXT_BUDGET_TOKENS = 1_050_000;
export const MAX_EMPTY_CONTINUATIONS = 2;
export const EMPTY_RESPONSE_CONTINUATION_PROMPT =
  "The plan is set but the active task is not complete. Continue executing the current action step immediately; do not end the turn without making progress.";

export const RATE_LIMIT_STATUS = 429;
export const SERVICE_UNAVAILABLE_STATUS = 503;

export const CLI_INPUT_PROMPT = "\n\x1b[1m\x1b[94m\x1b[100m cody> \x1b[0m ";
export const FORCED_COMPACTION_NOTICE = "\n⚠ Context is approaching the budget — running forced compaction…\n";
export const SCHEDULED_COMPACTION_NOTICE = "\n→ Running scheduled compaction check…\n";
export const CLI_EXIT_COMMAND = "exit";
export const REPLY_PREFIX = "> ";
export const DEFAULT_SCREEN_ROWS = 24;
export const TOOLS_CALLED_ANNOTATION = "\x1b[2m(tools were called)\x1b[0m\n";
export const ANSI_ITALIC_GREEN = "\x1b[3;32m";
export const ANSI_BOLD_YELLOW = "\x1b[1;33m";
export const ANSI_DIM_WHITE_ITALIC = "\x1b[2;37;3m";
export const ANSI_LIGHT_ORANGE = "\x1b[38;5;214m";
export const ANSI_RESET = "\x1b[0m";
