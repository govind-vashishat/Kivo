import type { AgentEvent } from "../agent/events";

export const c = {
    reset: "\x1b[0m",
    dim: "\x1b[90m",
    navy: "\x1b[38;2;90;120;200m",     // soft blue for rules/accents
    navyBold: "\x1b[1m\x1b[38;2;120;150;230m",
    prompt: "\x1b[38;2;130;160;255m",  // brighter blue for the prompt
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
};

export function rule(char = "-"): string {
    const width = Math.min(process.stdout.columns ?? 60, 80);
    return `${c.navy}${char.repeat(width)}${c.reset}`
}

let stopSpinner: (() => void) | null = null;

export function startSpinner(label = "thinking"): () => void {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const timer = setInterval(() => {
        process.stdout.write(`\r${c.navy}${frames[i++ % frames.length]}${c.reset} ${c.dim}${label}…${c.reset}`);
    }, 80);
    return () => {
        clearInterval(timer);
        process.stdout.write("\r\x1b[K");
    }
}

export function describeError(err: any): string {
    const status = err?.status;
    if (status === 401) return "OpenAI rejected the API key (401). Check OPENAI_API_KEY.";
    if (status === 429) return "Rate limited or out of quota (429). Check your OpenAI billing.";
    if (status === 404) return "Model not found (404). Your key may not have access to this model.";
    if (status >= 500) return `OpenAI server error ${status}. Try again in a moment`;
    if (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED")
        return "Network error — could not reach the OpenAI API.";
    return err?.message || String(err);
}

export function fatal(message: string, hint?: string): never {
    console.error(`\n ${c.red}kivo:${c.reset} ${message}`);
    if (hint) console.error(`${c.dim}${hint}${c.reset}`);
    process.exit(1);
}

//shared renderer - both for one shot tasks and interactive sessions - 
export function renderEvent(e: AgentEvent) {
    switch (e.type) {
        case "thinking_start":
            stopSpinner = startSpinner();
            break;
        case "thinking_end":
            stopSpinner?.();
            stopSpinner = null;
            break;
        case "text_delta":
            console.log(`\n${e.text}`);
            break;
        case "tool_start":
            console.log(`\n${c.cyan}→ ${e.name}${c.reset} ${c.dim}${JSON.stringify(e.input).slice(0, 120)}${c.reset}`);
            break;
        case "tool_result":
            console.log(
                e.isError
                    ? `  ${c.red}✗${c.reset} ${e.output.slice(0, 200)}`
                    : `  ${c.green}✓${c.reset} ${e.output.slice(0, 120)}`
            );
            break;
        case "turn_end":
            // close the task with a thin rule
            console.log(`\n${rule("─")}`);
            break;
        case "error":
            console.error(`\n${c.red}[error]${c.reset} ${e.message}`);
            break;
    }
}