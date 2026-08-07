# Agent Guidelines: Bun, TypeScript, Zod, and Pino (OpenTelemetry)

This document contains instructions, coding standards, and architectural patterns for developing in this codebase. Any agent or developer working on this project must follow these rules to maintain consistency, safety, and high-quality telemetry.

---

## 1. Environment & Runtime Rules

- **Runtime**: Always use [Bun](https://bun.sh/) as the runtime, package manager, and test runner.
- **Commands**:
  - Install dependencies: `bun install`
  - Run type checking: `bun tsc --noEmit`
  - Run development server: `bun run dev` (or `bun run src/index.ts` directly)
  - Run tests: `bun test`
- **Imports**: Prefer native Bun and modern ES Modules (ESM). Use explicit `import { ... } from "..."` syntax.

---

## 2. Code Quality & Type Safety (TypeScript)

- **Strict Type Checking**: Always write fully-typed TypeScript. Avoid the `any` type; use `unknown` if a type is truly dynamic, then narrow it using Zod or TypeScript type guards.
- **Type Compilation**: Use `bun tsc` regularly to check for type correctness. Do not suppress compiler errors with `// @ts-ignore` unless absolutely unavoidable and explicitly documented with a comment.
- **Async/Await**: Prefer `async/await` over raw Promises/`then`/`catch`. Always handle errors gracefully.

---

## 3. Data Validation (Zod)

Use [Zod](https://zod.dev/) for all boundaries (I/O, environment variables, API payloads, and config files) to ensure type safety at runtime.

### 3.1 Environment Variable Validation
Validate and parse `process.env` immediately at application startup. Do not access `process.env` directly throughout the codebase; instead, import a validated `env` object.

```typescript
// src/config/env.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SERVICE_NAME: z.string().default("harness-service"),
});

// Safe parse and print clear error messages on failure
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
```

### 3.2 Request/Input Validation
Define reusable schemas for payloads and extract TypeScript types directly from them.

```typescript
// src/schemas/user.schema.ts
import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  age: z.number().int().positive().optional(),
});

// Infer TS types from schemas
export type CreateUserDTO = z.infer<typeof createUserSchema>;
```

---

## 4. Structured Logging & OpenTelemetry (Pino)

All logs must be output as structured JSON stdout using [Pino](https://github.com/pinojs/pino). This ensures high-performance logging compatible with OpenTelemetry collectors (like Datadog, Grafana Loki, or Honeycomb).

### 4.1 Pino Configuration for OpenTelemetry (OTel)
Logs should include standard OTel resource and instrumentation attributes:
- Trace Context mapping: Include `trace_id`, `span_id`, and `trace_flags` when inside active tracing spans.
- Severity mapping: Map Pino numeric levels to standard OTel `SeverityText` and `SeverityNumber` if required, or keep Pino's highly-efficient format accompanied by standard attributes.

```typescript
// src/config/logger.ts
import pino from "pino";
import { env } from "./env";

// Helper to extract active OpenTelemetry trace context if available
// (Integrates with @opentelemetry/api if installed)
const getTraceContext = () => {
  try {
    const api = require("@opentelemetry/api");
    const activeSpan = api.trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      return {
        "trace.id": spanContext.traceId,
        "span.id": spanContext.spanId,
        "trace.flags": spanContext.traceFlags,
      };
    }
  } catch {
    // OpenTelemetry API not installed or configured yet
  }
  return {};
};

export const logger = pino({
  level: env.LOG_LEVEL,
  // Standard Pino configurations optimized for high throughput in production
  formatters: {
    level: (label, number) => {
      return { 
        level: label,
        // OTel LogRecord Severity mappings
        severityText: label.toUpperCase(),
        severityNumber: number,
      };
    },
    bindings: (bindings) => {
      return {
        "service.name": env.SERVICE_NAME,
        "service.version": process.env.npm_package_version ?? "1.0.0",
        environment: env.NODE_ENV,
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
  // Ensure we capture trace context in every log
  mixin() {
    return getTraceContext();
  },
  // Enable timestamp and serializing standard fields
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});
```

### 4.2 Logging Standards & Practices
- **Do not use `console.log`**. Always use `logger.info`, `logger.error`, `logger.warn`, or `logger.debug`.
- **Pass structured metadata** as the first argument, and the message string as the second argument:
  ```typescript
  // GOOD: Structured JSON output with query execution time
  logger.info({ durationMs: 45, query: "SELECT * FROM users" }, "Database query completed");

  // BAD: Interpolated string prevents structured search and indexing
  logger.info(`Database query completed in 45ms: SELECT * FROM users`);
  ```
- **Logging errors**: Always pass the `error`/`err` object directly so Pino's serializer can extract stack traces correctly.
  ```typescript
  try {
    // some code
  } catch (error) {
    logger.error({ err: error, context: "failed to fetch users" }, "Error encountered while fetching users");
  }
  ```

---

## 5. Directory Structure Reference

Follow this clean, domain-driven structure for Bun services:

```text
├── src/
│   ├── config/          # Environment & global configs (env.ts, logger.ts)
│   ├── schemas/         # Shared Zod schemas & types
│   ├── routes/          # API Route handlers (e.g., using Bun.serve)
│   ├── services/        # Business logic layers
│   ├── db/              # Database models, connections, migrations
│   ├── index.ts         # Application entry point
│   └── index.test.ts    # Test cases
├── bun.lock
├── package.json
├── tsconfig.json
└── agent.md             # This file
```
