import { openai } from "@ai-sdk/openai";
import { generateText, type ToolResultPart } from "ai";
import { ContextManager } from "./context";
import type { AgentEvent, AgentEventListener } from "./events";
import { executeTool, type ToolName, toolDefinitions } from "./tools";

export interface RunOptions {
    task: string;
    cwd: string;
    maxSteps?: number;
    model?: string;
    onEvent?: AgentEventListener;
    context?: ContextManager;
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
}

const SYSTEM_PROMPT = `You are a coding agent working in a real filesystem. You have tools to read, write, and edit files, and to run shell commands. Work step by step: inspect files before editing, make the smallest change that solves the task, and verify your work by running tests or build commands. When a command fails, read the error output and fix the actual problem — do not guess blindly or claim success without verifying.`;

export async function runAgent(opts: RunOptions): Promise<RunResult> {
    const { task, cwd, maxSteps = 30, model = process.env.KIVO_MODEL ?? "gpt-5", onEvent } = opts;
    const reasoning = process.env.KIVO_REASONING ?? "provider-default";
    const emit = (e: AgentEvent) => onEvent?.(e);

    const context = opts.context ?? new ContextManager();
    context.addUserMessage(task);

    const usage: TurnUsage[] = [];

    for (let step = 0; step < maxSteps; step++) {
        emit({ type: "turn_start", step: step + 1 });

        emit({ type: "thinking_start" });
        const result = await generateText({
            model: openai(model),
            instructions: SYSTEM_PROMPT,
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

        if (process.env.DEBUG)
            console.log(
                `tokens in: ${result.usage.inputTokens}, out: ${result.usage.outputTokens}`,
            );

        context.addModelOutput(result.responseMessages);

        if (result.text) {
            emit({ type: "text_delta", text: result.text });
        }

        if (result.toolCalls.length === 0) {
            emit({ type: "turn_end", stopReason: "completed" });
            return { stopReason: "completed", steps: step + 1, usage, model, reasoning };
        }

        const toolOutputs: ToolResultPart[] = [];
        for (const call of result.toolCalls) {
            emit({
                type: "tool_start",
                name: call.toolName,
                input: call.input,
                id: call.toolCallId,
            });

            const { output, isError } = await executeTool(
                call.toolName as ToolName,
                call.input,
                cwd,
            );

            emit({ type: "tool_result", id: call.toolCallId, output: output, isError: isError });

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
    }
    emit({ type: "turn_end", stopReason: "max_steps" });
    return { stopReason: "max_steps", steps: maxSteps, usage, model, reasoning };
}
