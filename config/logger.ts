import pino, { type Logger } from "pino"
import pretty from "pino-pretty"
import { Writable } from "node:stream"

const isDev = process.env.NODE_ENV !== "production"

const TOOLS_EMOJI = "\u{2699}"

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_RE = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g")

export function visualLines(text: string): number {
  const cols = process.stdout.columns ?? 80
  // pino-pretty colorizes log output; strip SGR codes so row counts reflect
  // visible width, not raw byte length
  const clean = text.replace(ANSI_ESCAPE_RE, "")
  if (clean === "") return 0
  let rows = 0
  for (const seg of clean.split("\n")) {
    if (seg.length > 0) rows += Math.ceil(seg.length / cols)
  }
  return rows + (clean.endsWith("\n") ? 1 : 0)
}

/**
 * Receipt of every log chunk written in dev, so the CLI can undo and re-render
 * a streamed reply without losing log lines that landed below it.
 */
export const logLedger: { lines: number; text: string }[] = []
const ledgerStream = new Writable({
  write(chunk, _enc, cb) {
    const text = chunk.toString()
    logLedger.push({ lines: visualLines(text), text })
    process.stdout.write(chunk)
    cb()
  },
})

// Create a synchronous pretty stream for local development
const prettyStream = isDev
  ? pretty({
      destination: ledgerStream,
      translateTime: "HH:MM:ss",
      ignore:
        "pid,hostname,severityText,severityNumber,service.name,service.version,environment",
      singleLine: true,
      colorize: true,
      sync: true, // Forces synchronous writes directly to stdout
      customPrettifiers: {
        level: (_value, _key, log, { labelColorized }) => {
          const emoji = /^\S+\s/
            .exec((log as { name?: string }).name ?? "")?.[0]
            ?.trim()
          return `${labelColorized}  ${emoji ?? TOOLS_EMOJI}`
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
