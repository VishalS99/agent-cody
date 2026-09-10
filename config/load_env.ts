import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const name = match[1];
    let value = match[2];
    if (name === undefined || value === undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[name] = value;
  }

  return values;
}

function loadEnvFile(path: string): void {
  try {
    const values = parseEnvFile(readFileSync(path, "utf8"));
    for (const [name, value] of Object.entries(values)) {
      process.env[name] ??= value;
    }
  } catch {
    // The executable can still use shell-provided environment variables.
  }
}

// Bun's compiled dotenv autoload uses the process cwd. Load the sidecar file
// next to the executable as well, so an absolute path works from any cwd.
loadEnvFile(join(dirname(process.execPath), ".env"));
