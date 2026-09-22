import OpenAI from "openai";
import type { AgentEvent, AgentEventListener } from "./events";
import { ContextManager } from "./context";
import { executeTool, toolDefinitions, type ToolName } from "./tools";

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

    const client = new OpenAI();
    const context = opts.context ?? new ContextManager();
    context.addUserMessage(task);

    const usage: TurnUsage[] = [];

    for (let step = 0; step < maxSteps; step++ ) {
        if (process.env.DEBUG) console.log(`\n===== ROUND ${step + 1} =====`);

        emit({ type: "thinking_start" });
        let response;
        try {
            response = await client.responses.create({
                model,
                instructions: SYSTEM_PROMPT,
                input: context.getItems(),
                tools: toolDefinitions,
            });
        } finally {
            emit({ type: "thinking_end" });
        }

        usage.push({
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
        });

        if(process.env.DEBUG) console.log(`tokens in: ${response.usage?.input_tokens}`);

        context.addModelOutput(response.output as any);
        if(response.output_text) {
            emit({ type: "text_delta", text: response.output_text });
        };

        const calls = response.output.filter(
            (item: any) => item.type === "function_call"
        );

        if(calls.length === 0) {
            emit({ type: "turn_end", stopReason: "completed" });
            return { stopReason: "completed", steps: step + 1 , usage };
        };

        const toolOutputs: any[] = [];
        for (const call of calls as any) {
            let args: any;
            try {
                args = JSON.parse(call.arguments);
            } catch (err: any) {
                const output = `Error: arguments for ${call.name} were not valid JSON (${err.message}). Raw arguments: ${call.arguments}`;

                emit({ type: "tool_start", name: call.name, input: call.arguments, id: call.call_id });
                emit({ type: "tool_result", id: call.call_id, output: output, isError: true });

                toolOutputs.push({
                    type: "function_call_output",
                    call_id: call.call_id,
                    output,
                });
                continue;
            }

            emit({ type: "tool_start", name: call.name, input: args, id: call.call_id });
            const { output, isError } = await executeTool(call.name as ToolName, args, cwd);
            emit({ type: "tool_result", id: call.call_id, output: output, isError: isError });

            toolOutputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output,
            });
        };
        context.addToolOutput(toolOutputs);
    };
    emit({ type: "turn_end", stopReason: "max_steps" });
    return { stopReason: "max_steps", steps: maxSteps, usage };
};