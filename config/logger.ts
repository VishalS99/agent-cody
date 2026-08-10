import pino, { type Logger } from "pino"
import pretty from "pino-pretty"

const isDev = process.env.NODE_ENV !== "production"

const TOOLS_EMOJI = "\u{2699}"

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
        // Tool logs put "<glyph> <toolname>" in `name`; show the glyph after
        // the level (labelColorized keeps the level color) and fall back to
        // the generic ⚙ otherwise
        level: (_value, _key, log, { labelColorized }) => {
          const emoji = /^\S+\s/.exec((log as { name?: string }).name ?? "")?.[0]?.trim()
          return `${labelColorized} ${emoji ?? TOOLS_EMOJI}`
        },
        // Strip the glyph prefix
        name: (value) => (value as string).replace(/^\S+\s/, ""),
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
