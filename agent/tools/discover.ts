import { bashExecToolDefinition } from "./bash_exec_tool/tool.js";
import { goalsToolDefinition } from "./context/goals.js";
import { stateToolDefinition } from "./context/state.js";
import { editFileToolDefinition } from "./edit_file_tool/tool.js";
import { fileToolDefinition } from "./file_tool/tool.js";
import { grepToolDefinition } from "./grep_tool/tool.js";
import { lsToolDefinition } from "./ls_tool/tool.js";
import { readFileToolDefinition } from "./read_file_tool/tool.js";

// tool definition discovery
export const allToolDefinitions = [
  bashExecToolDefinition,
  lsToolDefinition,
  readFileToolDefinition,
  grepToolDefinition,
  fileToolDefinition,
  stateToolDefinition,
  goalsToolDefinition,
  editFileToolDefinition,
];

export function getToolDefinitionByName(name: string) {
  const tool = allToolDefinitions.find(tool => tool.function.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

export function getToolDefinitionsByNames(names: string[]) {
  return names.map(toolName => getToolDefinitionByName(toolName));
}
