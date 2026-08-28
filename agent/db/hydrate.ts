import type { Messages } from "../../schemas/messages.js";
import type { AgentContext } from "../types.js";
import { createSessionStats } from "../stats.js";
import type { SessionStats } from "../stats.js";
import { logger } from "../../config/logger.js";
import { allowedRoot } from "../tools/fs_guard.js";
import { buildSystemPrompt } from "../prompt/prompt.js";
import { getToolDefinitionByName } from "../tools/discover.js";
import { selectSession } from "./session.js";
import type { SessionRecord } from "./session.js";
import { selectMessages, selectMessagesByLastCompaction } from "./messages.js";
import type { MessageRecord } from "./messages.js";
import { selectToolActions } from "./tool_actions.js";

export interface AgentContextFromSessionId {
  agentContext: AgentContext | null;
  stats: SessionStats | null;
  compactionCount: number | null;
  error: string;
}

export async function buildAgentContextFromSessionId(sessionId: string): Promise<AgentContextFromSessionId> {
  if (sessionId.trim() === "") {
    return {
      agentContext: null,
      stats: null,
      compactionCount: null,
      error: "Error: sessionId is empty",
    };
  }

  const root: string = await allowedRoot();

  const agc: AgentContext = {
    system_prompt: buildSystemPrompt(root),
    messages: [],
  };
  const sess: SessionRecord | null = selectSession(sessionId);

  if (sess == null) {
    return {
      agentContext: null,
      stats: null,
      compactionCount: null,
      error: "Error: session not found",
    };
  }

  if (sess.actionSteps) agc.action_steps = sess.actionSteps;
  if (sess.goal) agc.goal = sess.goal;
  if (sess.taskRequest) agc.task_request = sess.taskRequest;
  if (sess.state) agc.state = sess.state;

  const stats: SessionStats = sess.stats ?? createSessionStats();
  if (sess.availableTools) {
    agc.available_tools = [];
    sess.availableTools.forEach(toolName => {
      try {
        agc.available_tools?.push(getToolDefinitionByName(toolName));
      } catch (error) {
        logger.warn(
          {
            event: "tool_definition_restore_failed",
            tool: toolName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Unable to restore persisted tool definition",
        );
      }
    });
  }

  let messageRecords: MessageRecord[];
  if (sess.compactionCount === 0) {
    messageRecords = selectMessages(sessionId);
  } else {
    messageRecords = selectMessagesByLastCompaction(sessionId);
  }
  agc.messages = messageRecords.map(toMessage);

  const activeToolCallIds = new Set(
    agc.messages.filter(message => message.role === "tool").map(message => message.tool_call_id),
  );
  agc.tool_actions_taken = selectToolActions(sessionId).filter(action => activeToolCallIds.has(action.tool_call_id));

  return {
    agentContext: agc,
    stats: stats,
    compactionCount: sess.compactionCount,
    error: "",
  };
}

function toMessage(record: MessageRecord): Messages {
  return {
    role: record.role,
    content: record.content,
    ...(record.tool_call_id ? { tool_call_id: record.tool_call_id } : {}),
    ...(record.tool_calls ? { tool_calls: record.tool_calls } : {}),
    ...(record.name ? { name: record.name } : {}),
  };
}
