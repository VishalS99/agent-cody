import type { ToolDefinition } from "../../types.js";
import { websearchSchema } from "./schema.js";
import { parallelWebSearch, type parallelSearch } from "./parallel.js";

export const webSearchToolDefinition: ToolDefinition<typeof websearchSchema> = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web and return result titles, URLs, and excerpts.",
    label: "websearch",
    emoji: "\u{1F310}",
    parameters: websearchSchema,
    execute: async (toolId, { objective, search_queries, mode, max_chars_total }) => {
      try {
        const result = await parallelWebSearch({ objective, search_queries, mode, max_chars_total } as parallelSearch);
        return {
          tool_call_id: toolId,
          content: JSON.stringify(result),
          isError: false,
        };
      } catch (err) {
        return {
          tool_call_id: toolId,
          content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          isError: true,
        };
      }
    },
  },
};
