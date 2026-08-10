
# Agent Cody Banks
<img src="image.png" alt="Agent Cody Banks" width="80%"  />
A harness to learn about harnesses...

An interactive CLI agent harness built with Bun, TypeScript, and OpenAI-compatible APIs. Designed as a learning project to explore agent architectures, tool use, and structured telemetry.

## Overview

Agent Cody Banks is a command-line AI agent that helps with software engineering tasks. It interacts with users through a readline prompt, calls tools on their behalf (file listing, reading, searching), and tracks session statistics including token usage, tool call success rates, and response durations.

### Key Features

- **Interactive REPL**: Readline-based prompt loop with graceful exit on empty input
- **Tool Calling**: Automatic multi-turn tool execution (up to 50 iterations per turn)
- **Built-in Tools**:
  - `ls` — List directory contents with hidden file visibility controls
  - `read_file` — Read text files with line offsets, truncation handling, and binary detection
  - `edit_file` — Apply batched atomic edits (edit/insert/delete) to text files; all ops validated before mutation
  - `simple_grep` — Regex search across files with configurable context lines
- **Structured Logging**: JSON logging via Pino with OpenTelemetry-compliant attributes
- **Session Statistics**: Real-time tracking of tool calls, success/failure rates, token usage, and latency
- **Rate Limit Handling**: Graceful degradation on 429/503 responses
- **Strict Type Safety**: Full TypeScript with strict mode, Zod schemas for all boundaries

## Architecture

The codebase follows a layered architecture with unidirectional dependencies:

```
main.ts (entry)
    ↓
agent/ (orchestration layer)
    ├── loop.ts       — Agent loop: prompts, dispatches tools, tracks stats
    ├── types.ts      — AgentContext, ToolDefinition, ToolResult
    ├── prompt.ts     — System prompt defining Agent Cody's behavior
    ├── util.ts       — Wire-format conversion (ToolDefinition → ChatCompletionTool)
    ├── stats.ts      — SessionStats tracking and recording
    └── tools/        — Built-in tool implementations
        ├── ls.ts
        ├── read_file.ts
        ├── edit_file.ts
        ├── grep.ts
        └── bash_exec.ts   ← stub
llm/ (transport layer)
    ├── client.ts     — LLMClient: transforms messages to OpenAI API format
    ├── types.ts      — ConfigSchema, OpenAICompatConfig, LLMRequest
config/ (infrastructure)
    ├── env.ts        — Environment config (NVIDIA NIM API)
    └── logger.ts     — Pino logger with OTel formatting
schemas/messages.ts     — Message types (Role, Messages, ToolCall)
```

### Design Principles

- **Agent → LLM unidirectionality**: The agent layer constructs `LLMRequest` objects; the LLM layer never imports from agent
- **Schema-driven boundaries**: All I/O uses Zod schemas for runtime validation
- **Tool abstraction**: Tools define their own Zod parameters and an `execute` function; the loop handles dispatch and error handling uniformly

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- An NVIDIA API key (or compatible OpenAI API endpoint)

### Installation

```bash
bun install
```

### Configuration

Set the following environment variables:

```bash
export NVIDIA_API_KEY=your_api_key_here
export NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
export NVIDIA_MODEL=z-ai/glm-5.2
```

### Running

```bash
bun run start
# or
NODE_ENV=dev bun run main.ts
```

You'll see a prompt: `### Prompt:` — type your query and press Enter.

## Development

### Available Scripts

| Script            | Description                                      |
|-------------------|--------------------------------------------------|
| `bun run start`   | Start the agent (sets NODE_ENV=dev)              |
| `bun run typecheck` | Type check without emitting files             |
| `bun run format`  | Format code with Biome                           |
| `bun run format:check` | Check formatting without changes           |
| `bun run lint`    | Lint code with Biome                              |
| `bun run lint:fix` | Auto-fix lint issues                            |

### Code Style

- **Formatter**: Biome (2-space indent, double quotes, LF line endings, trailing commas)
- **Import style**: Use explicit ES module imports with `.js` extensions
- **No comments**: Unless explicitly requested
- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`

### Adding a New Tool

1. Create `agent/tools/my_tool.ts`
2. Define a Zod schema for parameters
3. Export a `ToolDefinition` with `name`, `description`, `label`, `parameters`, and `execute`
4. Register it in `agent/loop.ts` in the `available_tools` array
5. Run `bun run lint:fix` and `bun run typecheck`

## Telemetry

All logging is structured JSON via Pino, with OpenTelemetry-compatible fields:

- `service.name`, `service.version`, `environment` — standard OTel resource attributes
- `trace.id`, `span.id`, `trace.flags` — trace context (when OTel is configured)
- `severityNumber`, `severityText` — OTel log severity mapping
- `pino-pretty` is used for human-readable dev output

## Roadmap (TODO)

- [ ] `writefile` — create/overwrite files
- [ ] `editFile` — (implemented as `edit_file` — modify files in-place with batched atomic edits)
- [ ] `editFile` — modify files in-place (line-level edits)
- [ ] `filediff` — visual diffs between file versions
- [ ] `bash_exec` — shell command execution (validation/sandbox TBD)
- [ ] `websearch` — search the web
- [ ] `webfetch` — fetch content from URLs

## License

See [LICENSE](LICENSE) for details.
