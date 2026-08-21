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
}; 

export interface RunResult {
    stopReason: "completed" | "max_steps";
    steps: number;
}

const SYSTEM_PROMPT = `You are a coding agent working in a real filesystem. You have tools to read, write, and edit files, and to run shell commands. Work step by step: inspect files before editing, make the smallest change that solves the task, and verify your work by running tests or build commands. When a command fails, read the error output and fix the actual problem — do not guess blindly or claim success without verifying.`;

export async function runAgent(opts: RunOptions): Promise<RunResult> {
    const { task, cwd, maxSteps = 12, model = "gpt-5", onEvent } = opts;
    const emit = (e: AgentEvent) => onEvent?.(e);

    const client = new OpenAI();
    const context = new ContextManager();
    context.addUserMessage(task);

    for (let step = 0; step < maxSteps; step++ ) {
        const response = await client.responses.create({
            model: model,
            instructions: SYSTEM_PROMPT,
            input: context.getItems(),
            tools: toolDefinitions,
        });

        context.addModelOutput(response.output as any);

        if(response.output_text) {
            emit({ type: "text_delta", text: response.output_text });
        };

        const calls = response.output.filter(
            (item: any) => item.type === "function_call"
        );

        const toolOutputs: any[] = [];
        for (const call of calls as any) {
            const args = JSON.parse(call.arguments);

            emit({ type: "tool_start", name: call.name });
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
    return { stopReason: "completed", steps: maxSteps };
};