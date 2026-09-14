import type { AgentEvent } from "../agent/events";

//shared renderer - both for one shot tasks and interactive sessions - 
export async function renderEvent(e: AgentEvent) {
    switch(e.type) {
        case "text_delta":
            console.log(`\n${e.text}`);
            break;
        case "tool_start":
            console.log(`\n\x1b[36m→ ${e.name}\x1b[0m ${JSON.stringify(e.input).slice(0, 120)}`);
            break;
        case "tool_result":
            console.log(
                e.isError
                    ? `  \x1b[31m✗\x1b[0m ${e.output.slice(0, 200)}`
                    : `  \x1b[32m✓\x1b[0m ${e.output.slice(0, 120)}`
            );
            break;
        case "turn_end":
            break; //->session prints its own prompt after each turn end.
        case "error":
            console.error(`\n\x1b[31m[error]\x1b[0m ${e.message}`);
            break;
    }
}