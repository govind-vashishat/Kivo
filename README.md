# Kivo

A terminal coding agent, built by hand in TypeScript. No agent framework, no orchestration library — just a loop, four tools, and a typed event stream.

Kivo reads and edits files in your project, runs shell commands, reads the failures, and tries again. The whole thing is about 600 lines you can read in one sitting.

```
kivo "the tests in test.js are failing, find and fix the bug"
```

---

## Install

All paths need an OpenAI API key. Pick whichever fits.

**From npm** — needs [Bun](https://bun.sh) ≥ 1.1 installed

```bash
npm install -g kivoforge      # or: bun install -g kivoforge
```

> The package is published as **`kivoforge`** (the name `kivo` was taken). The command it installs is **`kivo`**.

**Straight from GitHub**

```bash
bun install -g github:govind-vashishat/Kivo
```

**From source**

```bash
git clone https://github.com/govind-vashishat/Kivo.git
cd Kivo
bun install
bun link          # makes `kivo` global
```

**Standalone binary (no Bun needed on the target machine)**

```bash
bun run build     # produces ./kivo — a single ~78MB executable
./kivo "fix the failing test"
```

Useful for demoing on a machine that doesn't have Bun installed. Copy the one file across and run it.

### API key

Kivo needs `OPENAI_API_KEY`. Either:

```bash
export OPENAI_API_KEY="sk-..."                            # this shell only
echo 'export OPENAI_API_KEY="sk-..."' >> ~/.zshrc         # permanent
```

…or drop a `.env` file in the directory you run `kivo` from:

```
OPENAI_API_KEY=sk-...
```

Bun loads `.env` automatically — this works for both `bun run` and the compiled binary.

---

## Usage

```bash
kivo                    # interactive session
kivo "<task>"           # run one task and exit
kivo --help
```

Kivo operates on the directory you run it from, so `cd` into the project you want it to work on.

In a session:

| command  | what it does                |
| -------- | --------------------------- |
| `/clear` | start a fresh conversation  |
| `/help`  | show commands               |
| `/exit`  | quit                        |

A session keeps one conversation context across prompts, so you can follow up ("now add a test for that") without re-explaining. One-shot runs get a fresh context each time.

---

## How it works

The whole agent is a loop. Each turn:

1. Send the conversation so far to the model, along with the tool schemas.
2. If the model returned no tool calls → it's done. Stop.
3. Otherwise run every tool call it asked for, append the results to the conversation, and go again.

That's it. That's the agent.

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

### Self-correction is free

There's no retry logic or error-recovery layer in Kivo. When a tool fails, it returns the failure **as its output** instead of throwing:

```ts
if (count === 0)
    return { output: `old_text not found in ${input.path}`, isError: true }
```

So the failure lands in the conversation as a normal tool result, the model reads it on the next turn, and adjusts. Run the tests, see the stack trace, fix the real bug. The "agentic" behaviour is a consequence of the loop plus honest error messages — not a feature anyone wrote.

### The context is ours, deliberately

Kivo uses the OpenAI Responses API but ignores `previous_response_id` and sends the full conversation itself every turn. That's slightly more work, and it's the point: **`ContextManager` owns the conversation**, which means context management and compaction are things Kivo can implement rather than things the API does invisibly. See [Roadmap](#roadmap).

### Tools

| tool         | notes                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| `read_file`  | full contents of a path                                                   |
| `write_file` | create or overwrite whole file                                            |
| `edit_file`  | replace an exact snippet; `old_text` must match **exactly once** or it errors |
| `run_bash`   | run a command in the working dir; returns stdout, stderr and exit code    |

`edit_file` refusing ambiguous matches is intentional — a silent wrong-place edit is far worse than an error the model can recover from.

### The event stream

The agent core (`src/agent/`) imports nothing UI-related. It emits a typed event stream, and every frontend subscribes:

```ts
export type AgentEvent =
    | { type: "text_delta"; text: string }
    | { type: "tool_start"; name: string, input: unknown, id: string }
    | { type: "tool_result"; id: string; output: string; isError: boolean }
    | { type: "turn_end"; stopReason: string }
    | { type: "error"; message: string }
    | { type: "thinking_start" }
    | { type: "thinking_end" }
```

The CLI renders these as coloured output and a spinner. The eval runner subscribes to nothing at all and just runs the agent silently. A web UI would be a third subscriber, with no changes to the core. Dependencies point inward — that's the one architectural rule the project holds to.

---

## Layout

```
src/
  agent/              ← imports nothing UI-specific
    events.ts         the AgentEvent protocol
    loop.ts           runAgent — the loop above
    tools.ts          tool schemas + executor
    context.ts        ContextManager — owns the conversation
  cli/
    index.ts          entry: task arg = one-shot, no arg = session
    session.ts        the REPL
    render.ts         event → terminal output, colours, spinner
evals/
  runner.ts           harness
  sandboxes/          broken repos + a judge for each
```

---

## Evals

Kivo scores itself on small broken repos. Each sandbox has intentionally broken code, a `test.js` that judges the fix, and a `task.json` with the prompt and a verify command.

```bash
bun run eval
```

The runner copies each sandbox to a temp dir (so the original stays broken and reproducible), runs the agent with no event listener, then runs the verify command. Exit code 0 = pass. Results append to `eval_history.json` so changes are comparable over time.

| sandbox           | task                          | result |
| ----------------- | ----------------------------- | ------ |
| `01-syntax-error` | unparseable file              | pass   |
| `02-failing-test` | off-by-one in a stats helper  | pass   |
| `03-multi-file`   | wrong prices across two files | pass   |

**3/3 baseline.** These are small on purpose — they're the starting instrument, not a benchmark. Harder and longer sandboxes are next, because the interesting measurements need tasks big enough to strain the context window.

Requires `node` on PATH (the sandboxes run `node test.js`).

---

## Roadmap

The next piece of real work is **context compaction** inside `ContextManager.getItems()`. Right now it returns the full conversation untouched, which means a long task eventually blows the context window. The plan is to compact older turns and measure the before/after against the eval suite — a real number, not a vibe.

Also queued:

- harder eval sandboxes (including "must still compile after the edit")
- streaming output instead of waiting for the full response
- Ctrl-C interrupt mid-task
- a web UI as a second consumer of the event stream

---

## Built with

Bun · TypeScript · OpenAI Responses API. No agent framework, by design.

## License

MIT