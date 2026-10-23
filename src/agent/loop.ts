import { openai } from "@ai-sdk/openai";
import { generateText, type ToolResultPart } from "ai";
import { type CompactSettings, clearOldToolOutput, compactSettings } from "./compaction";
import { ContextManager } from "./context";
import type { AgentEvent, AgentEventListener } from "./events";
import {
    type ApprovalRequest,
    COMMAND_TIMEOUT_MINUTES,
    describeChange,
    executeTool,
    type ToolName,
    toolDefinitions,
} from "./tools";

export interface RunOptions {
    task: string;
    cwd: string;
    maxSteps?: number;
    model?: string;
    onEvent?: AgentEventListener;
    context?: ContextManager;
    approve?: (request: ApprovalRequest) => Promise<boolean>;
}

export interface TurnUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
}

export interface RunResult {
    stopReason: "completed" | "max_steps";
    steps: number;
    usage: TurnUsage[];
    model: string;
    reasoning: string;
    compaction: CompactSettings & { count: number };
}

function systemPrompt(model: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `You are Kivo, a terminal coding agent. You run on OpenAI's ${model} model, inside the user's project folder. You can read, write and edit files and run shell commands there, and the user approves each change before it happens. If asked what you are, say this briefly in your own words.

Work step by step: inspect files before editing, make the smallest change that solves the task, and verify your work by running tests or build commands. When a command fails, read the error output and fix the actual problem — do not guess blindly or claim success without verifying.

Today's date is ${today}. Your training data is older than that, so CLIs, install commands and package versions may have changed since. When you are not sure how a tool is used today, check first with \`<command> --help\` or \`npm view <package> version\` instead of relying on memory.

Shell commands run without a terminal: they get no input and are stopped after ${COMMAND_TIMEOUT_MINUTES} minutes. Always pass non-interactive flags (such as --yes), and never start anything that keeps running, like a dev server or a watcher.

Reply in plain text. The terminal does not render Markdown, so do not use **bold**, # headings or tables.`;
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
    const { task, cwd, maxSteps = 100, model = process.env.KIVO_MODEL ?? "gpt-5", onEvent } = opts;
    const reasoning = process.env.KIVO_REASONING ?? "provider-default";
    const emit = (e: AgentEvent) => onEvent?.(e);

    const context = opts.context ?? new ContextManager();
    context.addUserMessage(task);

    const usage: TurnUsage[] = [];
    const compaction = { ...compactSettings(), count: 0 };
    const done = (stopReason: RunResult["stopReason"], steps: number) => {
        emit({ type: "turn_end", stopReason: stopReason });
        return { stopReason, steps, usage, model, reasoning, compaction };
    };

    for (let step = 0; step < maxSteps; step++) {
        emit({ type: "turn_start", step: step + 1 });

        emit({ type: "thinking_start" });
        const result = await generateText({
            model: openai(model),
            instructions: systemPrompt(model),
            messages: context.getItems(),
            tools: toolDefinitions,
            reasoning: reasoning as any,
        }).finally(() => emit({ type: "thinking_end" }));

        const turn: TurnUsage = {
            inputTokens: result.usage.inputTokens ?? 0,
            cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? 0,
        };

        usage.push(turn);
        emit({ type: "usage", step: step + 1, ...turn });

        context.addModelOutput(result.responseMessages);

        if (result.text) {
            emit({ type: "text_delta", text: result.text });
        }

        if (result.toolCalls.length === 0) {
            return done("completed", step + 1);
        }

        const toolOutputs: ToolResultPart[] = [];
        for (const call of result.toolCalls) {
            emit({
                type: "tool_start",
                name: call.toolName,
                input: call.input,
                id: call.toolCallId,
            });

            const request = opts.approve
                ? await describeChange(call.toolName as ToolName, call.input, cwd)
                : null;

            const approved = request && opts.approve ? await opts.approve(request) : true;

            const { output, isError } = approved
                ? await executeTool(call.toolName as ToolName, call.input, cwd)
                : {
                      output: "The user rejected this action. Ask them what they want instead.",
                      isError: true,
                  };

            emit({
                type: "tool_result",
                id: call.toolCallId,
                output: output,
                isError: isError,
            });

            toolOutputs.push({
                type: "tool-result",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: isError
                    ? { type: "error-text", value: output }
                    : { type: "text", value: output },
            });
        }
        context.addToolOutput(toolOutputs);

        if (compaction.mode === "clear" && turn.inputTokens >= compaction.clearAt) {
            const { messages, result: stats } = clearOldToolOutput(context.getItems(), compaction);
            if (stats.cleared > 0) {
                context.replaceItems(messages);
                compaction.count += 1;
                emit({ type: "compaction", kind: "clear", ...stats });
            }
        }
    }
    return done("max_steps", maxSteps);
}
