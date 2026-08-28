import { parseArgs } from "node:util";
import { runLoop } from "./agent/loop.js";
import { createAgent } from "./agent/session/factory.js";
import { persistSession } from "./agent/session/persist.js";

export { buildAgentContext } from "./agent/session/factory.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      sessionId: { type: "string" },
    },
    allowPositionals: true,
  });
  const sessionId = values.sessionId;
  const agent = await createAgent(sessionId);
  await runLoop(agent);
  persistSession(agent);
  console.log("Session: ", agent.getSessionId());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
