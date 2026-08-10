import pino, { type Logger } from "pino"
import pretty from "pino-pretty"

const isDev = process.env.NODE_ENV !== "production"

// U+1F6E0 — rendered after the level label (e.g. "INFO 🛠️ (ls):")
const TOOLS_EMOJI = "\u{1F6E0}"

// Create a synchronous pretty stream for local development
const prettyStream = isDev
  ? pretty({
      translateTime: "HH:MM:ss",
      ignore:
        "pid,hostname,severityText,severityNumber,service.name,service.version,environment",
      singleLine: true,
      colorize: true,
      sync: true, // Forces synchronous writes directly to stdout
      customPrettifiers: {
        // labelColorized keeps the level color; we only append the emoji
        level: (_value, _key, _log, { labelColorized }) =>
          `${labelColorized} ${TOOLS_EMOJI}`,
      },
    })
  : undefined

export const logger: Logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    ...(!isDev && {
      formatters: {
        level: (label, number) => ({
          level: label,
          severityText: label.toUpperCase(),
          severityNumber: number,
        }),
        bindings: (bindings) => ({
          "service.name": "harness",
          "service.version": process.env.npm_package_version ?? "1.0.0",
          environment: process.env.NODE_ENV ?? "development",
          pid: bindings.pid,
          hostname: bindings.hostname,
        }),
      },
    }),
  },
  prettyStream,
)
