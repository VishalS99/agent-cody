export { db } from "./connection.js";
export { initializeDatabase } from "./schema.js";
export type { SessionRecord } from "./session.js";
export { insertSession, selectSession, updateSession, deleteSession } from "./session.js";
export type { MessageRecord } from "./messages.js";
export {
  insertMessage,
  selectMessages,
  selectMessagesByLastCompaction,
  deleteMessages,
} from "./messages.js";
export type { ToolActionRecord } from "./tool_actions.js";
export { insertToolAction, insertToolMessageAndAction, selectToolActions } from "./tool_actions.js";
export type { AgentContextFromSessionId } from "./hydrate.js";
export { buildAgentContextFromSessionId } from "./hydrate.js";
