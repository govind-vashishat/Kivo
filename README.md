# Kivo

A minimal terminal coding agent written in TypeScript, without an agent framework.

Kivo reads and edits files in a project, runs shell commands, and uses the results to decide what to do next. The implementation is intentionally small (around 600 lines) so the full agent loop can be read end to end.

```bash
kivo "the tests in test.js are failing, find and fix the bug"
```

## Installation

Kivo requires [Bun](https://bun.sh) 1.1 or later and an OpenAI API key.

### npm

```bash
npm install -g kivoforge
# or
bun install -g kivoforge
```

The npm package is named `kivoforge` and installs the `kivo` command.

### From source

```bash
git clone https://github.com/govind-vashishat/Kivo.git
cd Kivo
bun install
bun link
```

### Standalone binary

To build a single executable that runs without Bun installed:

```bash
bun run build
./kivo --help
```

This produces a self-contained binary (~78 MB) for the current platform.

## Configuration

Set your API key in the environment:

```bash
export OPENAI_API_KEY="sk-..."
```

Alternatively, create a `.env` file in the directory where you run `kivo`:

```
OPENAI_API_KEY=sk-...
```

## Usage

```bash
kivo              # start an interactive session
kivo "<task>"     # run a single task and exit
kivo --help       # show usage
```

Kivo operates on the current working directory. Run it from the root of the project you want it to work on.

> **Note:** Kivo executes shell commands and file edits proposed by the model without asking for confirmation. Use it in a directory under version control.

### Session commands

| Command  | Description                   |
| -------- | ----------------------------- |
| `/clear` | Reset the conversation        |
| `/help`  | Show available commands       |
| `/exit`  | Quit                          |

In an interactive session, conversation context persists across prompts. Single-task runs start with a fresh context.

## How it works

Kivo runs a single loop:

1. Send the conversation and tool definitions to the model.
2. If the response contains no tool calls, the task is complete.
3. Otherwise, execute each tool call, append the results to the conversation, and repeat.

```
user task ──▶ ┌─────────────────────────────┐
              │  model call (+ tool schemas) │◀────┐
              └──────────────┬───────────────┘     │
                             │                     │
                  any tool calls?                  │
                    │            │                 │
                   no           yes                │
                    │            │                 │
                   done    run tools, append       │
                           results to context ─────┘
```

### Error handling

Tool failures are returned to the model as tool output rather than raised as exceptions. A failed edit, a missing file, or a non-zero exit code becomes part of the conversation, and the model can adjust on the next step. There is no separate retry mechanism.

### Context management

Kivo does not use the Responses API's server-side conversation state (`previous_response_id`). The full conversation is held in `ContextManager` and sent with each request, which keeps context handling, including future compaction, under the application's control.

### Tools

| Tool         | Description                                                           |
| ------------ | --------------------------------------------------------------------- |
| `read_file`  | Read the contents of a file                                           |
| `write_file` | Create or overwrite a file                                            |
| `edit_file`  | Replace an exact snippet; fails unless `old_text` matches exactly once |
| `run_bash`   | Run a shell command in the working directory; returns stdout, stderr, and exit code |

`edit_file` requires a unique match so that ambiguous edits fail instead of applying to the wrong location.

### Events

The agent core in `src/agent/` has no dependency on the CLI. It emits a typed event stream, which the CLI and the eval runner each consume independently.

```ts
export type AgentEvent =
    | { type: "text_delta"; text: string }
    | { type: "tool_start"; name: string; input: unknown; id: string }
    | { type: "tool_result"; id: string; output: string; isError: boolean }
    | { type: "turn_end"; stopReason: string }
    | { type: "error"; message: string }
    | { type: "thinking_start" }
    | { type: "thinking_end" }
```

## Project structure

```
src/
  agent/
    events.ts     AgentEvent types
    loop.ts       runAgent: the agent loop
    tools.ts      tool definitions and executor
    context.ts    ContextManager: conversation state
  cli/
    index.ts      entry point (single task or session)
    session.ts    interactive session
    render.ts     terminal output
bin/
  kivo.mjs        launcher used by the npm package
evals/
  runner.ts       evaluation harness
  sandboxes/      test repositories
```

## Evaluation

The `evals/` directory contains small repositories with known bugs. Each sandbox includes a `task.json` (the prompt and a verification command) and a `test.js` that checks the fix.

```bash
bun run eval
```

Each sandbox is copied to a temporary directory, the agent runs against the copy, and the verification command determines pass or fail. Results are appended to `eval_history.json`. Running the evals requires Node.js.

Current results:

| Sandbox           | Task                               | Result |
| ----------------- | ---------------------------------- | ------ |
| `01-syntax-error` | Fix an unparseable file            | Pass   |
| `02-failing-test` | Fix an off-by-one error            | Pass   |
| `03-multi-file`   | Fix incorrect prices across files  | Pass   |

These tasks are intentionally small. Longer tasks are planned to exercise context management.

## Roadmap

- Context compaction in `ContextManager`, measured against the eval suite
- Longer, multi-step eval tasks
- Streaming responses
- Interrupting a running task with Ctrl-C
- Web UI built on the event stream

## License

MIT