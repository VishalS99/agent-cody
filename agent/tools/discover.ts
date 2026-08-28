import { bashExecToolDefinition } from "./bash_exec/index.js";
import { goalsToolDefinition } from "./context/goals.js";
import { stateToolDefinition } from "./context/state.js";
import { editFileToolDefinition } from "./edit_file/index.js";
import { fileToolDefinition } from "./file/index.js";
import { grepToolDefinition } from "./grep/index.js";
import { lsToolDefinition } from "./ls/index.js";
import { readFileToolDefinition } from "./read_file/index.js";

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
