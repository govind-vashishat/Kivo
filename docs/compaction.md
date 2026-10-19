# Context compaction

Status: design (v0.2, issue #27). Not implemented yet.

## Problem

Kivo is stateless: every turn it sends the whole conversation to the model —
system prompt, task, every message, every tool call and every tool result. The
conversation only grows, so each request is bigger than the last, and the
total cost of a run grows roughly with the square of the number of turns.

Measured on the long-run sandboxes (gpt-5-mini, low reasoning, 6 runs each):

| Sandbox | Steps | Peak input | Total input | Cached | Fresh (total − cached) |
|---|---|---|---|---|---|
| 05 events pipeline | 11–15 | 7.7k | 57k | ~80% | ~11k |
| 06 fulfillment tickets | 16–19 | 15.3k | 163k | ~90% | ~16.5k |

Most of the peak is old tool output: file contents and test output from early
turns that later turns no longer need in full. That is what compaction should
remove.

Peak is far below gpt-5-mini's 400k window, so this is not about running out
of room yet. It is about:

1. **Cost** — every token in the context is paid for again on every later turn.
2. **Quality** — models use a long context less reliably; old, stale output
   competes with what matters now.
3. **Smaller windows** — other providers and local models (v0.3) have much
   less room.

Goal for v0.2: **the same pass rate with less fresh input**, measured on
sandboxes 05 and 06.

## How other agents do it

- **OpenCode** compacts late (window minus a ~20k reserve), summarizes the
  history with the same model and tools off, keeps the most recent ~8k tokens
  word for word, and updates the previous summary on later compactions.
- **Claude Code** works in layers: once the context passes a warning level it
  clears old tool output without a model call, and only summarizes near the
  full window (around 89%, per third-party analyses).
- Both avoid compacting often, because compacting changes the start of the
  conversation and breaks the prompt cache.

Kivo's design is inspired by Claude Code's layered approach. The thresholds
below are Kivo's own starting points, to be tuned by the evals.

## Design

Two layers, cheapest first. Each layer has **its own threshold**, because they
solve different problems. **v0.2 builds layer 1 only.** Layer 2 is built only
if the evals show it is needed.

| | Layer 1: clear old tool output | Layer 2: summarize |
|---|---|---|
| Model call | none | yes |
| What's lost | old outputs the model can re-read from disk | details the summary leaves out |
| Solves | cost and quality | running out of room |
| Triggers | early-ish, fixed token count | late, percentage of the window |

### Layer 1: clear old tool output (no model call)

When the context reaches the layer 1 threshold, replace the text of old tool
results with a short placeholder:

```
[cleared to save context: read_file src/dates.js, 2,940 chars. Run the tool again if you need it.]
```

Rules:

- **Keep the structure.** The tool call and its result stay where they are;
  only the result's `value` text changes. The API requires every tool call to
  have a matching result, and the model can still see what it did.
- **Keep the last N turns untouched** (default 3). The model never loses what
  it was just working on.
- **Skip small outputs** (under ~500 chars). Clearing them saves almost
  nothing and loses information.
- **Batch it.** When it triggers, clear everything eligible at once. The
  context drops well below the threshold and stays quiet for many turns. That
  is one cache break, not one per turn.
- **Never clear twice.** Cleared results are skipped next time.

A "turn" is one model response (an assistant message) plus the tool message
that follows it.

### Layer 2: summarize (later, only if needed)

When the context reaches a percentage of the model's window (around 85%),
replace the oldest turns with one message containing a structured summary
(goal, what's done, files changed, decisions, next steps), written by the
model with tools off. Keep the last N turns word for word. Cut only between
turns, never between a tool call and its result.

This needs each model's window size, which fits with v0.3 (any model).

## When it triggers

After every model call the loop already knows the real request size
(`turn.inputTokens`). There's no need to estimate tokens the way OpenCode
does.

- **Layer 1:** a fixed token count, because its job is cost, and cost depends
  on how many tokens are resent, not on how big the window is.
- **Layer 2:** a percentage of the window, because its job is to keep the task
  from hitting the limit.

Layer 1 should not fire too early either: every compaction breaks the cache
once. Batching keeps that rare. The best layer 1 threshold is what #29 finds
out.

## Where it lives

- `ContextManager.clearOldToolOutput({ keepTurns, minChars })` in
  `src/agent/context.ts`. It walks the messages, edits old tool results in
  place, and returns `{ cleared, charsBefore, charsAfter }`.
- `runAgent` calls it after `usage.push(turn)` when the threshold is reached.
  The loop stays small; the logic stays in the context manager.
- A new event, `{ type: "compaction", kind: "clear", cleared, charsBefore, charsAfter }`,
  so the UI can show a line in the transcript and the eval runner can count
  compactions.

## Settings

Environment variables for now, like `KIVO_MODEL` (flags come with #31):

| Variable | Values | Default |
|---|---|---|
| `KIVO_COMPACT` | `off`, `clear` | `off` until evals show it helps |
| `KIVO_CLEAR_AT` | input tokens | `40000` (starting guess) |
| `KIVO_CLEAR_KEEP` | turns kept untouched | `3` |

Layer 2 will get its own setting (for example `KIVO_SUMMARIZE_AT_PERCENT=85`)
when it is built.

The eval runner records the compaction settings in every `eval_history.json`
record, so runs with and without compaction can never be mixed up.

## How it will be measured (#29)

Run sandboxes 05 and 06 with `--runs 5` or more, with the model and reasoning
fixed:

- `KIVO_COMPACT=off` (baseline)
- `KIVO_COMPACT=clear`, `KIVO_CLEAR_AT=8000`, so it actually fires on these
  sandboxes

Compare:

- pass rate (must not drop)
- **fresh input** (total − cached), the main cost number
- total input and peak input
- number of compactions per run
- re-reads: how often the model reads a file again after its output was
  cleared. Many re-reads mean we cleared things it still needed.

Single runs vary by about 2× on identical code, so compare means and ranges,
never single runs.

## Open questions

- What is the lowest layer 1 threshold where the savings outweigh the cache
  break?
- Which N (turns kept) gives the best savings without hurting the pass rate?
- Is clearing tool results alone enough, or do large tool-call inputs (for
  example `write_file` content) also need clearing?
- If clearing doesn't pay off at this size, that is a result too: the default
  threshold should sit where it starts paying off.