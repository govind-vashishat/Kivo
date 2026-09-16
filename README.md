# Kivo

A terminal coding agent. Kivo takes a task in plain English, then reads, writes, and edits
files and runs shell commands in your working directory until the task is done — reporting
each tool call as it goes.

It is built on Bun and the OpenAI Responses API, and ships with an eval harness that scores
the agent against sandboxed bug-fixing tasks.

```
 ██╗  ██╗██╗██╗   ██╗ ██████╗
 ██║ ██╔╝██║██║   ██║██╔═══██╗
 █████╔╝ ██║██║   ██║██║   ██║
 ██╔═██╗ ██║╚██╗ ██╔╝██║   ██║
 ██║  ██╗██║ ╚████╔╝ ╚██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═════╝
```

## Requirements

- [Bun](https://bun.sh)
- An OpenAI API key with access to the model you point Kivo at (`gpt-5` by default)

## Setup

```sh
bun install
```

Put your key in a `.env` file at the repo root — Bun loads it automatically:

```sh
OPENAI_API_KEY=sk-...
```

## Usage

Run a single task and exit:

```sh
bun run agent "fix the failing test in stats.js"
```

Run with no arguments to open an interactive session that keeps one conversation context
across turns:

```sh
bun run agent
```

Session commands:

| Command | Effect |
| --- | --- |
| `/clear` | Start a fresh conversation (drops all context) |
| `/help` | Show the command list |
| `/exit` (or `/quit`) | Quit |

Set `DEBUG=1` to print round markers to stdout while the loop runs.

> Kivo runs shell commands and writes files in `process.cwd()` without asking for
> confirmation. Start it from a directory you're willing to let it change.

## Tools

The agent is given four tools:

| Tool | What it does |
| --- | --- |
| `read_file` | Read a file's full contents |
| `write_file` | Create a file or overwrite it entirely |
| `edit_file` | Replace an exact snippet; `old_text` must match exactly once |
| `run_bash` | Run a shell command in the working directory, returning stdout, stderr, and exit code |

## How it works

`runAgent` drives a loop, capped at `maxSteps` (30 by default):

1. Send the conversation so far to the model, along with the tool schemas.
2. Append the model's output to the context and emit any text it produced.
3. If the model requested no tool calls, the turn is complete — stop.
4. Otherwise execute each requested tool, feed the results back into the context, and repeat.

Progress is reported through an event stream (`text_delta`, `tool_start`, `tool_result`,
`thinking_start`/`thinking_end`, `turn_end`, `error`). The CLI subscribes with `renderEvent`
to draw the terminal UI; the eval runner passes no listener at all, so the agent runs silently.

## Evals

```sh
bun run eval
```

The runner copies each directory under `evals/sandboxes/` into a temp directory, runs the
agent on that sandbox's prompt, then executes the manifest's `verifyCommand` and records a
pass if it exits 0. The temp directory is removed afterward, so the sandboxes themselves are
never mutated. Results print per-task plus an overall accuracy, and every record is appended
to `evals/eval_history.json` (gitignored) so runs can be compared over time.

A sandbox is a folder containing the broken project plus a `task.json` manifest:

```json
{
    "id": "01-syntax-error",
    "prompt": "math.js has a syntax error and won't run. Fix it so that `node test.js` passes.",
    "verifyCommand": "node test.js",
    "maxSteps": 8
}
```

Add a new case by dropping another directory in `evals/sandboxes/` with the same shape.

## Layout

```
src/
  agent/
    loop.ts       agent loop: model call → tool execution → repeat
    tools.ts      tool schemas and their implementations
    context.ts    conversation history for a session
    events.ts     event types emitted during a run
  cli/
    index.ts      entry point: one-shot task or interactive session
    session.ts    REPL, banner, and slash commands
    render.ts     ANSI colors, spinner, and event rendering
evals/
  runner.ts       sandbox harness and scoring
  sandboxes/      one directory per eval task
```
