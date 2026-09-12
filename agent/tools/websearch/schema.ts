import * as z from "zod";

/**
 * we need 3 schemas
 * 1. websearch schema input
 * 2. websearch schema output
 * 3. parallel web search schema response
 *
 * do we need context duplication from mainagent -> no, lets have it use empty context + websearch specific prompt
 * lets keep responses very minimal - remove all stop words fillers etc, provide respomse unslop mode
 *
 */

export const websearchSchema = z
  .object({
    objective: z
      .string()
      .max(5000)
      .optional()
      .describe("Describe the search goal in a concise, standalone sentence. Name the key entity or topic."),
    search_queries: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(5)
      .describe(
        "Provide 1-3 keyword queries of 3-6 words each. Include the key entity or topic in every query. For multiple queries, vary names, synonyms, or angles. Do not use sentences, instructions, or site: operators.",
      ),
    mode: z
      .enum(["turbo", "basic", "advanced"])
      .default("advanced")
      .describe("turbo ~250ms cheapest, basic low-latency, advanced highest quality ~3s"),
    max_chars_total: z
      .number()
      .int()
      .min(1000)
      .max(100000)
      .optional()
      .describe("Upper bound across all excerpts; omit for Parallel defaults"),
  })
  .refine(v => v.search_queries.length > 0);

export const parallelWebSearchResponseSchema = z.object({
  search_id: z.string(),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable().optional(),
      publish_date: z.string().nullable().optional(),
      excerpts: z.array(z.string()),
    }),
  ),
  warnings: z.unknown().nullable().optional(),
  session_id: z.string().optional(),
});

export const websearchSynthesisSchema = z
  .object({
    summary: z.string(),
    citations: z.array(z.url()).describe("Subset of result URLs actually used, in relevance order"),
  })
  .refine(v => !v.summary || (v.summary && v.citations.length > 0));

export type WebsearchSynthesis = z.infer<typeof websearchSynthesisSchema>;
export type ParallelWebSearchResponse = z.infer<typeof parallelWebSearchResponseSchema>;
export type WebsearchInput = z.infer<typeof websearchSchema>;
