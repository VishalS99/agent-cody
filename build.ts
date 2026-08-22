const compactionTurnThreshold = Number(process.env.COMPACTION_TURN_THRESHOLD ?? "25");

if (!Number.isInteger(compactionTurnThreshold) || compactionTurnThreshold < 1) {
  throw new Error("COMPACTION_TURN_THRESHOLD must be a positive integer");
}

const build = async () => {
  return await Bun.build({
    entrypoints: ["main.ts"],
    target: "bun",
    bytecode: true,
    env: "disable",
    compile: {
      autoloadDotenv: true,
      outfile: "./build/cody",
    },
    minify: true,
    sourcemap: true,
    // @ts-expect-error Bun 1.3 supports the json and markdown metafile paths.
    metafile: {
      json: "metafile.json",
      markdown: "metafile.md",
    },
    drop: ["console"],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      BUILD_VERSION: JSON.stringify("0.7"),
      BUILD_TIME: JSON.stringify(new Date().toISOString()),
      COMPACTION_TURN_THRESHOLD_BUILD: String(compactionTurnThreshold),
    },
  });
};

try {
  const result = await build();
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exitCode = 1;
  }
} catch (err) {
  const error = err as AggregateError;
  console.error("BUILD FAILED", error);
  process.exitCode = 1;
}
