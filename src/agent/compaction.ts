import type { ModelMessage, ToolResultPart } from "ai";

const DEFAULT_CLEAR_AT = 40000;
const DEFAULT_KEEP_TURNS = 3;
const MIN_CHARS = 500;
const MIN_TOTAL_CHARS = 4000;
const CLEARED_PREFIX = "[cleared to save context:";

export interface CompactSettings {
    mode: "off" | "clear";
    clearAt: number;
    keepTurns: number;
}

export interface ClearResult {
    cleared: number;
    charsBefore: number;
    charsAfter: number;
}

export function compactSettings(): CompactSettings {
    const clearAt = Number(process.env.KIVO_CLEAR_AT ?? DEFAULT_CLEAR_AT);
    const keepTurns = Number(process.env.KIVO_CLEAR_KEEP ?? DEFAULT_KEEP_TURNS);
    return {
        mode: process.env.KIVO_COMPACT === "clear" ? "clear" : "off",
        clearAt: Number.isFinite(clearAt) && clearAt > 0 ? clearAt : DEFAULT_CLEAR_AT,
        keepTurns: Number.isInteger(keepTurns) && keepTurns >= 0 ? keepTurns : DEFAULT_KEEP_TURNS,
    };
}

export function clearOldToolOutput(
    messages: ModelMessage[],
    { keepTurns }: Pick<CompactSettings, "keepTurns">,
): { messages: ModelMessage[]; result: ClearResult } {
    const result: ClearResult = { cleared: 0, charsBefore: 0, charsAfter: 0 };

    const toolIndexes = messages.flatMap((m, i) => (m.role === "tool" ? [i] : []));
    const eligible = toolIndexes.slice(0, Math.max(0, toolIndexes.length - keepTurns));

    //Pass 1 - find what could be cleared -
    const targets = new Set<string>(); //tool call ids
    let clearable = 0;
    for (const index of eligible) {
        const message = messages[index];
        if (message?.role !== "tool") continue;
        for (const part of message.content) {
            if (part.type !== "tool-result") continue;
            const value = textOf(part);
            if (value === null || value.length < MIN_CHARS || value.startsWith(CLEARED_PREFIX)) {
                continue;
            }
            targets.add(part.toolCallId);
            clearable += value.length;
        }
    }

    //Don't clear and break prompt cache for tiny savings
    if (clearable < MIN_TOTAL_CHARS) return { messages, result };

    //Pass 2 - return new list with placeholders in place of the targets -
    const calls = describeCalls(messages);
    const next = messages.map((message) => {
        if (message.role !== "tool") return message;
        if (!message.content.some((p) => p.type === "tool-result" && targets.has(p.toolCallId))) {
            return message;
        }

        const content = message.content.map((part) => {
            if (part.type !== "tool-result" || !targets.has(part.toolCallId)) return part;
            const value = textOf(part) ?? "";
            const what = calls.get(part.toolCallId) ?? part.toolName;
            const size = value.length.toLocaleString("en-us");
            const placeholder = `${CLEARED_PREFIX}, ${what}, ${size} chars. Run the tool again if you need it.]`;

            result.cleared += 1;
            result.charsBefore += value.length;
            result.charsAfter += placeholder.length;

            const type = part.output.type === "error-text" ? "error-text" : "text";
            return { ...part, output: { type, value: placeholder } } satisfies ToolResultPart;
        });
        return { ...message, content };
    });
    return { messages: next, result };
}

function textOf(part: ToolResultPart): string | null {
    const { output } = part;
    return output.type === "text" || output.type === "error-text" ? output.value : null;
}

function describeCalls(messages: ModelMessage[]): Map<string, string> {
    const calls = new Map<string, string>();
    for (const message of messages) {
        if (message.role !== "assistant" || typeof message.content === "string") continue;
        for (const part of message.content) {
            if (part.type === "tool-call") {
                calls.set(part.toolCallId, describeCall(part.toolName, part.input));
            }
        }
    }
    return calls;
}

function describeCall(toolName: string, input: unknown): string {
    if (input && typeof input === "object") {
        const { path, command } = input as { path?: string; command?: string };
        if (typeof path === "string") return `${toolName} ${path}`;
        if (typeof command === "string") {
            const short = command.length > 60 ? `${command.slice(0, 60)}` : command;
            return `${toolName} \`${short}\``;
        }
    }
    return toolName;
}
