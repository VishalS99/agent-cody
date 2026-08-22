import { runLoop } from "./agent/loop.js";

async function main(): Promise<void> {
  await runLoop();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
