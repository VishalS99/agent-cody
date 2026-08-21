# Bash Exec Plan

## Goal

Add a `bash_exec` tool for running project commands while keeping the host
filesystem and environment isolated.

## Security Model

- Sandboxed execution is mandatory.
- The workspace is mounted at `/workspace`.
- The sandbox working directory is `/workspace`.
- The host home directory is never mounted.
- The workspace is writable by default; read-only mode is an explicit option.
- Network access is disabled.
- Unsandboxed execution is rejected. Command blacklists are not a security
  boundary.

## Sandbox

Use Bubblewrap (`bwrap`) on Linux with:

- Read-only mounts for the runtime paths required by commands.
- A private `/dev` and `/proc`.
- An isolated `/tmp`.
- `--unshare-all` and `--unshare-net` by default.
- `--clearenv` with a small controlled environment, including `PATH` and
  `HOME`.
- `--new-session`, `--cap-drop ALL`, and `--die-with-parent`.
- `--chdir /workspace`.
- `bash -c <command>` for shell command compatibility.

Network access is not supported by this tool. Do not use `--share-net`, and do
not expose host DNS or certificate configuration for network use.

## Input Contract

The tool should accept:

```ts
{
  command: string;
  cwd?: string;
  sandbox?: true;
  writable?: boolean;
  timeoutMs?: number;
}
```

Defaults:

- Sandboxing is always enabled. If a caller supplies `sandbox: false`, return
  a validation error and do not execute the command.
- `writable: true`
- If a caller requests network access, return a validation error and do not
  execute the command.
- A bounded command timeout
- A bounded stdout and stderr size

`cwd` must resolve inside the workspace using `resolveInsideRoot()`. After
validation, convert the host path to its sandbox path:

```text
<workspace>/src -> /workspace/src
```

Pass only the converted path to Bubblewrap with `--chdir`. Never pass the host
workspace path into the sandbox command.

## Filesystem Guard

The guard validates every existing path component with `lstat()` and resolves
symlinks with `realpath()`. If the final file does not exist, the existing
parent is still resolved and checked before the remaining components are
appended.

This protects file-tool paths. It does not safely validate arbitrary shell
commands. Bubblewrap remains the security boundary for `bash_exec`.

## Process Handling

The implementation must:

- Verify that `bwrap` and `bash` are available.
- Use an argument array for the process launcher.
- Capture stdout and stderr separately.
- Enforce output size limits.
- Start Bubblewrap in its own host-side process group/session.
- On timeout, kill the whole Bubblewrap process group, not only the launcher.
- Keep `--die-with-parent` enabled as a second cleanup safeguard.
- Return exit code, signal, timeout status, stdout, and stderr.
- Report startup and Bubblewrap failures as tool errors.

The timeout cleanup must verify that the process-group ID belongs to the
current command before sending a negative-PID signal. Never kill the agent's
own process group. If group cleanup fails, terminate the launcher and report
the cleanup failure.

Resource limits for CPU, memory, process count, and workspace disk usage
should be added where the runtime and operating system support them.

## Logging

Log only the command statement executed inside the sandbox, for example:

```text
sandboxed bash command: npm test
```

Do not log the host-side `bwrap` invocation, mount arguments, environment, or
the host workspace path. Command output belongs in the tool result, not in the
execution log.

## Execution Shape

The command should be launched conceptually as:

```text
bwrap <sandbox arguments> -- bash -c <command>
```

The workspace binding should be either:

```text
--bind <workspace> /workspace
```

or, for read-only execution:

```text
--ro-bind <workspace> /workspace
```

Use `--bind` by default so commands can create and modify project files. Use
`--ro-bind` when `writable: false`.

Mounting at `/workspace` is preferred over preserving the host path. It keeps
host paths out of the sandbox, makes the sandbox layout predictable, avoids
exposing the host directory structure, and works consistently across machines.

Do not mount the workspace at `/`; doing so hides the sandbox runtime paths
and creates path collisions with system directories.

## Implementation Phases

1. Define the Zod input and result schemas.
2. Resolve the workspace and requested working directory.
3. Build and validate the Bubblewrap argument list.
4. Implement bounded process execution and timeout cleanup.
5. Register the tool in `agent/loop.ts`.
6. Add tests for command output, failures, timeouts, path escape attempts,
   symlink escape attempts, network isolation, and read-only mode.
7. Keep unsandboxed execution rejected; it is outside this tool's scope.

## Non-Goals

- Supporting unsandboxed shell execution.
- Mounting the user home directory into the sandbox.
- Providing unrestricted network access by default.
- Treating workspace isolation as protection against changes inside the
  workspace itself.
