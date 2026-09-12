import Parallel from "parallel-web";
import type { SearchParams } from "parallel-web/resources/top-level.js";
import { logger } from "../../../config/logger.js";
import { parallelWebSearchResponseSchema, type ParallelWebSearchResponse } from "./schema.js";

let cachedClient: Parallel | null = null;

function getClient(): Parallel {
  const apiKey = process.env.PARALLEL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing PARALLEL_API_KEY environment variable");
  }
  cachedClient ??= new Parallel({ apiKey });
  return cachedClient;
}

// parallel schema
export interface parallelSearch {
  search_queries: string[];
  objective?: string;
  mode: "turbo" | "fast" | "basic" | "advanced";
  max_chars_total?: number;
  session_id?: string;
}

export async function parallelWebSearch(query: parallelSearch): Promise<ParallelWebSearchResponse> {
  let search: unknown;
  try {
    search = await getClient().search(query as SearchParams);
  } catch (err) {
    const status = (err as { status?: number } | undefined)?.status;
    logger.error({ event: "websearch_api_error", status, err: String(err) }, "Parallel search request failed");
    if (status === 400) {
      throw new Error(`Invalid search request (400): ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  const parsed = parallelWebSearchResponseSchema.safeParse(search);
  if (!parsed.success) {
    logger.error({ event: "websearch_validation_error" }, "Parallel response failed validation");
    throw new Error("Parallel response failed validation");
  }
  return parsed.data;
}
