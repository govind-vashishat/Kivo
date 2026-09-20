#!/usr/bin/env node

// Node-compatible launcher.
//
// Why this file exists: src/cli/index.ts starts with `#!/usr/bin/env bun`.
// If npm installs Kivo on a machine without Bun, that shebang fails with a
// cryptic `env: bun: No such file or directory`. This runs on plain Node,
// checks for Bun, and either hands off to it or explains how to get it.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "cli", "index.ts");
const isWindows = process.platform === "win32";

// Is Bun on this machine?
const probe = spawnSync("bun", ["--version"], {
    stdio: "ignore",
    shell: isWindows,
});

if (probe.error || probe.status !== 0) {
    console.error(`
 kivo runs on Bun, which wasn't found on this machine.

 Install it:
   curl -fsSL https://bun.sh/install | bash        # macOS / Linux
   powershell -c "irm bun.sh/install.ps1 | iex"    # Windows

 Then run kivo again.
`);
    process.exit(1);
}

// Hand off. stdio: "inherit" keeps the terminal wired up, so colours,
// the spinner, and the interactive session's readline all still work.
const run = spawnSync("bun", ["run", entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: isWindows,
});

process.exit(run.status ?? 1);