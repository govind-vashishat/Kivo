# Kivo

A terminal coding agent written in TypeScript, without an agent framework.

Kivo reads and edits files in your project, runs shell commands, and uses the results to decide what to do next. It shows you a diff and asks before every change.

![Kivo in the terminal](https://raw.githubusercontent.com/govind-vashishat/Kivo/main/docs/images/screenshot.png)

```bash
kivo "the tests in test.js are failing, find and fix the bug"
```

## Installation

Kivo needs [Bun](https://bun.sh) 1.1 or later and an OpenAI API key.

```bash
npm install -g kivoforge
# or
bun install -g kivoforge
```

The npm package is `kivoforge`; the command it installs is `kivo`.

### From source

```bash
git clone https://github.com/govind-vashishat/Kivo.git
cd Kivo
bun install
bun link
```

### Standalone binary

```bash
bun run build
./kivo --help
```

This builds a single executable (about 100 MB) for your platform that runs without Bun installed.

## Configuration

```bash
export OPENAI_API_KEY="sk-..."
```

Or put it in a `.env` file in the folder you run `kivo` from.

| Variable         | Default            | Description                                    |
| ---------------- | ------------------ | ---------------------------------------------- |
| `OPENAI_API_KEY` | (required)         | Your OpenAI API key                            |
| `KIVO_MODEL`     | `gpt-5`            | Any OpenAI model, e.g. `gpt-5-mini`            |
| `KIVO_REASONING` | provider default   | Reasoning effort, e.g. `low`, `medium`, `high` |
| `DEBUG`          | off                | Set to `1` to show token usage for every step  |

## Usage

```bash
kivo                  # start an interactive session
kivo "<task>"         # run one task and exit
kivo --yes "<task>"   # run without asking for approval (also -y)
kivo --help           # show usage
```

Kivo works in the current directory. Run it from the root of the project you want it to work on.

### Approvals

Before Kivo writes or edits a file, it shows the diff and asks `y` / `n`. Before it runs a command, it shows the command and asks the same. If you say no, the model is told and asks what you want instead.

Commands that only read, such as `ls`, `cat`, `grep` or `git status`, run without asking. Anything that chains, redirects or could write still asks. `--yes` turns approvals off, for scripts and CI.

Shell commands run without a terminal: they get no input, most tools are told to skip their prompts, and a command is stopped after 5 minutes. A command can never hang Kivo waiting for an answer.

### Session commands

| Command  | Description            |
| -------- | ---------------------- |
| `/clear` | Reset the conversation |
| `/help`  | Show available commands |
| `/exit`  | Quit                   |

In a session, the conversation carries over between prompts. A single-task run starts fresh.

## How it works

Kivo runs one loop:

1. Send the conversation and the tool definitions to the model.
2. If the response has no tool calls, the task is done.
3. Otherwise, run each tool call (asking first if it changes something), add the results to the conversation, and repeat.

```
user task ──▶ ┌──────────────────────────────┐
              │  model call (+ tool schemas) │◀────┐
              └──────────────┬───────────────┘     │
                             │                     │
                  any tool calls?                  │
                    │            │                 │
                   no           yes                │
                    │            │                 │
                   done    approve, run tools,     │
                           append results ─────────┘
```

The Vercel AI SDK is used only to call the model. The loop, tools, approvals and context are Kivo's own code.

### Error handling

Tool failures go back to the model as tool output instead of being thrown. A failed edit, a missing file or a non-zero exit code becomes part of the conversation, and the model adjusts on the next step.

### Context

The full conversation is kept in `ContextManager` and sent with every request, instead of relying on server-side conversation state. That keeps context handling, including the planned compaction, in Kivo's control.

### Tools

| Tool         | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `read_file`  | Read a file                                                                 |
| `write_file` | Create or overwrite a file                                                  |
| `edit_file`  | Replace an exact snippet; fails unless `old_text` matches exactly once      |
| `run_bash`   | Run a shell command in the project folder; returns stdout, stderr and exit code |

`edit_file` requires a unique match, so an ambiguous edit fails instead of landing in the wrong place.

### Events

The agent core in `src/agent/` imports nothing from the UI. It emits a typed event stream that the terminal UI and the eval runner each consume.

```ts
export type AgentEvent =
    | { type: "turn_start"; step: number }
    | { type: "text_delta"; text: string }
    | { type: "usage"; step: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }
    | { type: "tool_start"; name: string; input: unknown; id: string }
    | { type: "tool_result"; id: string; output: string; isError: boolean }
    | { type: "turn_end"; stopReason: string }
    | { type: "error"; message: string }
    | { type: "thinking_start" }
    | { type: "thinking_end" };
```

## Project structure

```
src/
  agent/
    loop.ts        runAgent: the agent loop and system prompt
    tools.ts       tool definitions, executor, approval requests
    readonly.ts    which shell commands can run without asking
    context.ts     ContextManager: conversation state
    events.ts      AgentEvent types
  cli/
    index.ts       entry point and flags
    render.ts      error messages, debug event printer
    ui/            terminal UI built with Ink (React for the terminal)
      App.tsx      state, keyboard, agent events
      views.tsx    transcript items, tool lines, approval prompt, input
      DiffView.tsx diffs with line numbers
      Banner.tsx   logo and header
      theme.ts     colours
bin/
  kivo.mjs         launcher used by the npm package
evals/
  runner.ts        evaluation harness
  sandboxes/       small projects with known bugs
```

## Evaluation

`evals/` holds small projects with known bugs. Each sandbox has a `task.json` (the prompt and a verification command) and a `test.js` that checks the fix.

```bash
bun run eval              # every sandbox once
bun run eval 04 --runs 3  # sandboxes matching "04", three runs each
```

Each sandbox is copied to a temporary folder and the agent runs on the copy. `test.js` is restored before verifying, so the agent can't pass by editing the test. Every run records pass or fail, steps, peak, total and cached input tokens, output tokens, model, reasoning effort and git commit to `evals/eval_history.json`. With `--runs`, the runner prints the mean and range per sandbox, because a single run of an agent is not a reliable number. Running the evals needs Node.js.

Results with `gpt-5-mini`, low reasoning, 3 runs each:

| Sandbox               | Task                                               | Passed | Avg input tokens |
| --------------------- | -------------------------------------------------- | ------ | ---------------- |
| `01-syntax-error`     | Fix a file that doesn't parse                      | 3/3    | ~2.4k            |
| `02-failing-test`     | Fix an off-by-one error                            | 3/3    | ~3.0k            |
| `03-multi-file`       | Fix wrong prices across files                      | 3/3    | ~5.8k            |
| `04-invoice-currency` | Trace a currency bug through a six-module invoicing system | 3/3 | ~25k        |

Total input tokens grow with the square of the number of steps, because the whole conversation is re-sent every turn. Compaction is the next step, and these evals are how it will be judged.

## Roadmap

- **v0.2 Long tasks:** longer eval sandboxes, then context compaction, measured with and without
- **v0.3 Any model:** a `--model` flag across providers, the eval suite run on several models, a project instructions file
- **v0.4 Smoother terminal:** streaming output, Ctrl-C to interrupt a running task
- **v0.5 Knows your codebase:** a repo map, measured as fewer exploration steps
- **v0.6 Web UI:** a local server streaming the same events to a browser
- Later: image input, memory across sessions

## License

MIT