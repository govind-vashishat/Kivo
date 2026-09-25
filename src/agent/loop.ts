import type { AgentEvent, AgentEventListener } from "./events";
import { ContextManager } from "./context";
import { executeTool, toolDefinitions, type ToolName } from "./tools";
import { generateText, type ToolResultPart } from "ai";
import { openai } from "@ai-sdk/openai";

export interface RunOptions {
    task: string;
    cwd: string;
    maxSteps?: number;
    model?: string;
    onEvent?: AgentEventListener;
    context?: ContextManager;
}; 

export interface TurnUsage {
    inputTokens: number;
    outputTokens: number;
};

export interface RunResult {
    stopReason: "completed" | "max_steps";
    steps: number;
    usage: TurnUsage[];
};

const SYSTEM_PROMPT = `You are a coding agent working in a real filesystem. You have tools to read, write, and edit files, and to run shell commands. Work step by step: inspect files before editing, make the smallest change that solves the task, and verify your work by running tests or build commands. When a command fails, read the error output and fix the actual problem — do not guess blindly or claim success without verifying.`;

export async function runAgent(opts: RunOptions): Promise<RunResult> {
    const { task, cwd, maxSteps = 30, model = "gpt-5", onEvent } = opts;
    const emit = (e: AgentEvent) => onEvent?.(e);

    const context = opts.context ?? new ContextManager();
    context.addUserMessage(task);

    const usage: TurnUsage[] = [];

    for (let step = 0; step < maxSteps; step++ ) {
        if (process.env.DEBUG) console.log(`\n===== ROUND ${step + 1} =====`);

        emit({ type: "thinking_start" });
        let result;
        try {
            result = await generateText({
                model: openai(model),
                instructions: SYSTEM_PROMPT,
                messages: context.getItems(),
                tools: toolDefinitions,
            });
        } finally {
            emit({ type: "thinking_end" });
        }

        usage.push({
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
        });

        if(process.env.DEBUG) console.log(`tokens in: ${result.usage.inputTokens}, out: ${result.usage.outputTokens}`);

        context.addModelOutput(result.responseMessages);

        if(result.text) {
            emit({ type: "text_delta", text: result.text });
        };

        if(result.toolCalls.length === 0) {
            emit({ type: "turn_end", stopReason: "completed" });
            return { stopReason: "completed", steps: step + 1 , usage };
        };

        const toolOutputs: ToolResultPart[] = [];
        for (const call of result.toolCalls) {
            emit({ type: "tool_start", name: call.toolName, input: call.input, id: call.toolCallId });

            const { output, isError } = await executeTool(call.toolName as ToolName, call.input, cwd);

            emit({ type: "tool_result", id: call.toolCallId, output: output, isError: isError });

            toolOutputs.push({
                type: "tool-result",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: isError
                        ? { type: "error-text", value: output }
                        : { type: "text", value: output  }
            });
        };
        context.addToolOutput(toolOutputs);
    };
    emit({ type: "turn_end", stopReason: "max_steps" });
    return { stopReason: "max_steps", steps: maxSteps, usage };
};