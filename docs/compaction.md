# Context compaction

Status: layer 1 implemented (v0.2, #28), off by default. Measured in #29.

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
sandbox 06.

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
are Kivo's own, tuned by the evals below.

## Design

Two layers, cheapest first. Each layer has **its own threshold**, because they
solve different problems. **v0.2 builds layer 1 only.**

| | Layer 1: clear old tool output | Layer 2: summarize |
|---|---|---|
| Model call | none | yes |
| What's lost | old outputs the model can re-read from disk | details the summary leaves out |
| Solves | cost and quality | running out of room |
| Triggers | fixed token count | percentage of the window |

### Layer 1: clear old tool output (no model call)

When a request reaches the layer 1 threshold, the text of old tool results is
replaced with a short placeholder:

```
[cleared to save context: read_file src/dates.js, 2,940 chars. Run the tool again if you need it.]
```

Rules:

- **Keep the structure.** The tool call and its result stay where they are;
  only the result's `value` text changes. The API requires every tool call to
  have a matching result, and the model can still see what it did.
- **Keep recent output by a token budget** (default 8,000 tokens, estimated
  as chars ÷ 4). Walking from the newest output back, outputs are kept while
  everything newer still fits in the budget; older ones can be cleared. This
  turn's outputs are always kept, since the model hasn't seen them yet. A
  budget protects the same amount of work whether the model calls one tool
  per turn or five; "the last 3 turns" did not.
- **Skip small outputs** (under 500 chars). Clearing them saves almost
  nothing and loses information.
- **Skip small savings.** If everything eligible adds up to less than 4,000
  chars (~1k tokens), nothing is cleared: it isn't worth breaking the cache.
- **Batch it.** When it triggers, everything eligible is cleared at once.
- **Never clear twice.** Cleared results are skipped next time.

A "turn" is one model response (an assistant message) plus the tool message
that follows it.

### Layer 2: summarize (not built)

When the context reaches a percentage of the model's window (around 85%),
replace the oldest turns with one message containing a structured summary
(goal, what's done, files changed, decisions, next steps), written by the
model with tools off. Keep the recent turns word for word. Cut only between
turns, never between a tool call and its result.

This needs each model's window size, which fits with v0.3 (any model).

## When it triggers

After every model call the loop already knows the real request size
(`turn.inputTokens`), so there is no need to estimate tokens.

- **Layer 1:** a fixed token count, because its job is cost, and cost depends
  on how many tokens are resent, not on how big the window is.
- **Layer 2:** a percentage of the window, because its job is to keep the task
  from hitting the limit.

## Where it lives

- `src/agent/compaction.ts`: `compactSettings()` reads the environment, and
  `clearOldToolOutput(messages, { keepTokens })` is a pure function that
  returns `{ messages, result }`, a new message list plus
  `{ cleared, charsBefore, charsAfter }`. It never changes its input.
- `ContextManager` only gains `replaceItems(items)`. It stays a store.
- `runAgent` decides *when*: after a turn's tool results are added, if
  `turn.inputTokens >= clearAt`, it calls `clearOldToolOutput` and, if anything
  was cleared, swaps in the new list and emits
  `{ type: "compaction", kind: "clear", cleared, charsBefore, charsAfter }`.
- The Ink UI and the DEBUG renderer show that event as a dim transcript line.
  The eval runner records the settings (`off` or `clear@<at> keep<n>`) and the
  number of compactions in every `eval_history.json` record.

## Settings

Environment variables for now, like `KIVO_MODEL` (flags come with #31):

| Variable | Values | Default |
|---|---|---|
| `KIVO_COMPACT` | `off`, `clear` | `off` |
| `KIVO_CLEAR_AT` | input tokens | `40000` |
| `KIVO_CLEAR_KEEP_TOKENS` | tokens of recent tool output kept | `8000` |

## Results (#29)

Sandbox 06 (9 files, 4 tickets, 23 tests), gpt-5-mini, low reasoning. Fresh
input is total − cached: the tokens billed at full price, and the main cost
number. Pass rate was **100% in every run of every setting.**

| | Off | Clear @ 8k | Clear @ 12k |
|---|---|---|---|
| Runs | 10 | 10 | 10 |
| Steps | 16.5 | 23.3 | 16.9 |
| Peak input | 14.7k | 9.8k | 12.2k |
| Total input | 142k | 142k | 115k |
| Cached | ~88% | ~68% | ~80% |
| **Fresh input** | **16.4k** | **45.7k** | **22.2k** |
| Clears per run | 0 | 2–7 | 0–1 |

### 8k: thrashing

8k is about the size of the files the model is actively working on. Right
after a clear the context was already close to 8k again, so it cleared, the
model re-read what it had lost, the context climbed back over 8k, and it
cleared again — up to 7 times in one run.

In a traced run: 14 `read_file` calls plus one shell read, against 10 with
compaction off (`test.js` and `pricing.js` were read 4 times each). The turn
after each clear showed `cached 0` or `cached 1536`. One `edit_file` failed
because the model wrote it from memory of a file that had been cleared.

Fresh input was ~2.8× higher than off, and the ranges of the two settings did
not overlap.

"Keep the last 3 turns" made this worse: gpt-5-mini read about one file per
turn here, so 3 turns protected only 3 files. `test.js`, the spec for the
whole task, was cleared six turns after it was read.

### 12k: one clear, roughly break-even

At 12k it cleared at most once per run and did not thrash. In a traced batch,
each clear removed 7–8 outputs (~33k chars, ~8–9k tokens) and the next request
dropped from ~12k to 3–5k tokens, with nothing cached.

Break-even, measured from that trace (fresh token = 1, cached token ≈ 0.1):

- **Cost, once:** the ~3.4k tokens left after the clear are sent fresh instead
  of ~12k sent cached: ~2.2 units.
- **Saving, per later turn:** ~8.6k fewer cached tokens: ~0.86 units.
- **Break-even:** ~3 turns after the clear.

One run that cleared with 4 turns left came out about even. One cleared on its
last tool turn and lost. Batch averages show 12k slightly worse than off, but
that is mostly because only the longer runs reach 12k, plus occasional cache
misses the clear didn't cause. **On a task this size, the cost effect of one
clear is within the run-to-run noise.**

### What this means

1. Clearing works mechanically and doesn't hurt the pass rate.
2. A threshold near the working set thrashes and costs ~2–3× more. The
   threshold must sit well above it.
3. With prompt caching, cleared tokens were already cheap (~10% price), so
   clearing is a small effect. It pays back in a few turns, but loses when it
   fires near the end of a task or repeatedly.
4. Fresh input is the honest cost number. Total input stayed the same at 8k
   while fresh input almost tripled.

**Decision:** layer 1 ships **off by default**, with `KIVO_CLEAR_AT` at
40000, far above the working set of these tasks. Layer 2 is not needed for
v0.2.

## Next steps

- **Keep recent output by token budget, not turns.** How many files "3 turns"
  protects depends on how many tools the model calls per turn; a token budget
  protects the same amount every time.
- **A guard against repeated clears:** no second clear until the previous one
  has had time to pay off.
- **A much longer sandbox (40+ steps)**, where a clear has many turns left to
  pay back, to measure compaction where it should matter.
- **Cost per run** in the eval runner, including output tokens.