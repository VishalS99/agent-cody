import { parseArgs } from "node:util";
import { ANSI_RESET, ANSI_WHITE, ANSI_YELLOW } from "./agent/constants.js";
import { runLoop } from "./agent/loop.js";
import { createAgent } from "./agent/session/factory.js";
import { persistSession } from "./agent/session/persist.js";

export { buildAgentContext } from "./agent/session/factory.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      new: { type: "boolean" },
      sessionId: { type: "string" },
    },
    allowPositionals: true,
  });
  const sessionId = values.sessionId;
  try {
    const agent = await createAgent(sessionId, values.new);
    await runLoop(agent);
    persistSession(agent);
    process.stdout.write(`${ANSI_WHITE}Session Id: ${ANSI_YELLOW}${agent.getSessionId()}${ANSI_RESET}\n`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
